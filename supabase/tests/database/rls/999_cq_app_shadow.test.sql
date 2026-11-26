-- W2-C step 3 (ADR 0082 §5, shadow mode): the request login drops to the
-- non-bypass role inside a savepoint, the way the transaction helper's
-- shadow read does (packages/database/src/rls-shadow.ts), and is back to
-- itself after ROLLBACK TO SAVEPOINT.
--
-- Proves, against migration 20261231600300:
--   * postgres is a member of cq_app with SET and without INHERIT, and
--     cq_app still cannot log in and never bypasses RLS;
--   * as cq_app with the owner's claims, the owner's read returns their
--     own rows (the same count as the bypass read: no would-deny);
--   * as cq_app with another tenant's / another person's claims, the same
--     read returns nothing (the count difference shadow mode reports);
--   * after ROLLBACK TO SAVEPOINT, current_user and any claim changed
--     inside the savepoint are back as they were, and the transaction
--     carries on (a shadow read never poisons the unit).
--
-- Values read as cq_app are captured client-side (\gset), because the
-- savepoint's rollback undoes anything written server-side.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

-- Seed as the test's own (privileged) identity: one item each for user A
-- (tenant A) and user B (tenant B).
insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key) values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'NOTE', 'A''s note', 1, 'PERSON', gen_random_uuid()),
  (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'NOTE', 'B''s note', 1, 'PERSON', gen_random_uuid());

select current_user as bypass_user,
       pg_temp.rls_id('tenant_a') as tenant_a,
       pg_temp.rls_id('user_a') as user_a,
       pg_temp.rls_id('tenant_b') as tenant_b,
       pg_temp.rls_id('user_b') as user_b
\gset

-- The membership ------------------------------------------------------------------

select ok(exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles g on g.oid = m.member
     where r.rolname = 'cq_app' and g.rolname = 'postgres'
       and m.set_option and not m.inherit_option),
  'postgres may SET ROLE cq_app, and inherits nothing from it');
select ok((select not rolbypassrls and not rolcanlogin from pg_roles where rolname = 'cq_app'),
  'cq_app still cannot log in and never bypasses RLS');

-- The unit's claims, as the transaction helper sets them (transaction-local).
select set_config('cq.tenant_id', :'tenant_a', true),
       set_config('cq.user_id', :'user_a', true),
       set_config('cq.organisation_id', '', true),
       set_config('cq.actor_type', 'HUMAN', true);

-- The bypass read (the person's answer) ---------------------------------------------

select count(*)::int as bypass_own_rows from workspace.board_items
 where tenant_id = :'tenant_a' and user_id = :'user_a' \gset
select count(*)::int as bypass_cross_rows from workspace.board_items
 where tenant_id = :'tenant_b' \gset

-- The shadow read: owner's claims, inside a savepoint, as cq_app ---------------------

savepoint rls_shadow_1;
select set_config('role', 'cq_app', true);
select current_user as shadow_user \gset
select count(*)::int as enforced_own_rows from workspace.board_items
 where tenant_id = :'tenant_a' and user_id = :'user_a' \gset
-- The same predicate on another tenant's rows: the bypass read sees them,
-- the enforced one must not (what RLS_WOULD_DENY reports).
select count(*)::int as enforced_cross_rows from workspace.board_items
 where tenant_id = :'tenant_b' \gset
-- A claim changed inside the savepoint is undone with it.
select set_config('cq.tenant_id', :'tenant_b', true);
rollback to savepoint rls_shadow_1;

select is(:'shadow_user'::text, 'cq_app'::text, 'inside the savepoint the read runs as cq_app');
select is(:bypass_own_rows, 1, 'bypass: the owner''s query finds their one item');
select is(:enforced_own_rows, :bypass_own_rows, 'enforced: the owner''s claims see the same rows (no would-deny)');
select is(:bypass_cross_rows, 1, 'bypass: a query for tenant B''s rows finds them');
select is(:enforced_cross_rows, 0, 'enforced: tenant A''s claims see none of tenant B''s rows');
select is(current_user::text, :'bypass_user'::text, 'after ROLLBACK TO SAVEPOINT current_user is the bypass role again');
select is(current_setting('cq.tenant_id', true), :'tenant_a'::text,
  'after ROLLBACK TO SAVEPOINT a claim changed inside it is back to the unit''s');

-- Another person (tenant B's) claims: the same read of A's rows sees none ----------

select set_config('cq.tenant_id', :'tenant_b', true),
       set_config('cq.user_id', :'user_b', true);
savepoint rls_shadow_2;
select set_config('role', 'cq_app', true);
select count(*)::int as enforced_b_on_a from workspace.board_items
 where tenant_id = :'tenant_a' and user_id = :'user_a' \gset
select count(*)::int as enforced_b_own from workspace.board_items \gset
rollback to savepoint rls_shadow_2;

select is(:enforced_b_on_a, 0, 'another tenant''s claims: A''s items are invisible to cq_app');
select is(:enforced_b_own, 1, 'another tenant''s claims: only their own item is visible');
select is(current_user::text, :'bypass_user'::text, 'and the role is back again after the second rollback');

-- The unit carries on after the shadow savepoints: still the bypass role,
-- still sees every row, and may still write.
select is((select count(*)::int from workspace.board_items
            where tenant_id in (:'tenant_a', :'tenant_b')), 2,
  'after the shadow reads the transaction is whole: the bypass read sees both items');

select * from finish();

rollback;
