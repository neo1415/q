-- W2-C (ADR 0082) · proof of concept: workspace under the non-bypass
-- request role cq_app, with the transaction's claims.
--
-- Positive: the owner's claims reach their own items and history, and may
-- add and change them. Negative: another person in the same tenant, the
-- same person id under another tenant, no claims at all and a malformed
-- claim reach nothing and write nothing; a revoked grant refuses outright.
-- The role itself: NOLOGIN and never bypasses RLS.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

insert into pg_temp.rls_fixture (label, id) values
  ('auth_a2', '00000000-0000-4000-8000-0000000000a6'),
  ('item_a',  '00000000-0000-4000-8000-0000000000e1'),
  ('item_a2', '00000000-0000-4000-8000-0000000000e2'),
  ('item_b',  '00000000-0000-4000-8000-0000000000e3');
-- cq_app reads the fixture ids while acting, as the browser roles do.
grant select on pg_temp.rls_fixture to cq_app;
-- The test's own identity may become cq_app (rolled back with the suite;
-- no such membership exists outside this transaction).
grant cq_app to postgres;
-- pgTAP's own functions live in `extensions`; the suite asserts as cq_app.
grant usage on schema extensions to cq_app;

-- The role ---------------------------------------------------------------------

select ok(exists (select 1 from pg_roles where rolname = 'cq_app'), 'cq_app exists');
select ok((select not rolbypassrls and not rolcanlogin and not rolsuper from pg_roles where rolname = 'cq_app'),
  'cq_app never bypasses RLS, cannot log in yet and is no superuser');
select is(
  (select coalesce(string_agg(p.policyname, ', ' order by 1), '')
     from pg_policies p
    where p.schemaname = 'workspace' and not (p.roles = array['cq_app']::name[])),
  '', 'every workspace policy is for cq_app only (none for a browser role)');

-- Seed as the test's own (privileged) identity: one item each for user A
-- (tenant A), user B (tenant B) and a second person in tenant A (their
-- profile is created through auth, as the fixture's are).
insert into auth.users (id, email) values
  (pg_temp.rls_id('auth_a2'), 'rls-user-a2@example.invalid');
insert into pg_temp.rls_fixture (label, id)
select 'user_a2', p.id from identity.user_profiles p where p.auth_user_id = pg_temp.rls_id('auth_a2');

insert into workspace.board_items (id, tenant_id, user_id, kind, title, position, created_by, idempotency_key) values
  (pg_temp.rls_id('item_a'),  pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),  'NOTE', 'A''s note',  1, 'PERSON', gen_random_uuid()),
  (pg_temp.rls_id('item_a2'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a2'), 'NOTE', 'A2''s note', 1, 'PERSON', gen_random_uuid()),
  (pg_temp.rls_id('item_b'),  pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),  'NOTE', 'B''s note',  1, 'PERSON', gen_random_uuid());
insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor) values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),  pg_temp.rls_id('item_a'),  1, 'ADDED', 'PERSON'),
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a2'), pg_temp.rls_id('item_a2'), 1, 'ADDED', 'PERSON'),
  (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),  pg_temp.rls_id('item_b'),  1, 'ADDED', 'PERSON');

-- As cq_app with claims, the way the transaction helper sets them.
create function pg_temp.as_cq_app(p_tenant text, p_user text) returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('cq.tenant_id', coalesce(p_tenant, ''), true);
  perform set_config('cq.user_id', coalesce(p_user, ''), true);
  perform set_config('cq.organisation_id', '', true);
  perform set_config('cq.actor_type', 'HUMAN', true);
  execute 'set local role cq_app';
end;
$$;

-- Positive: the owner -------------------------------------------------------------

select pg_temp.as_cq_app(pg_temp.rls_id('tenant_a')::text, pg_temp.rls_id('user_a')::text);
select is((select count(*)::int from workspace.board_items), 1, 'owner: sees exactly their one item');
select is((select title from workspace.board_items), 'A''s note', 'owner: it is their own');
select is((select count(*)::int from workspace.board_item_events), 1, 'owner: sees their own history only');
select lives_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'TASK', 'A''s task', 2, 'Q', gen_random_uuid()) $$,
  'owner: adds an item of their own (Q for them included)');
select lives_ok(
  $$ update workspace.board_items set status = 'DOING', revision = revision + 1 where id = pg_temp.rls_id('item_a') $$,
  'owner: changes their own item');
select is((select status from workspace.board_items where id = pg_temp.rls_id('item_a')), 'DOING',
  'owner: the change holds');
select lives_ok(
  $$ insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('item_a'), 2, 'MOVED', 'PERSON') $$,
  'owner: records their own history');

-- Negative: another person in the same tenant -------------------------------------

select pg_temp.as_cq_app(pg_temp.rls_id('tenant_a')::text, pg_temp.rls_id('user_a2')::text);
select is((select count(*)::int from workspace.board_items where user_id = pg_temp.rls_id('user_a')), 0,
  'same tenant, another person: A''s items are invisible');
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'NOTE', 'planted', 3, 'PERSON', gen_random_uuid()) $$,
  '42501', null, 'same tenant, another person: cannot add an item to A''s board');
update workspace.board_items set title = 'hijacked', revision = revision + 1 where id = pg_temp.rls_id('item_a');
select pg_temp.as_cq_app(pg_temp.rls_id('tenant_a')::text, pg_temp.rls_id('user_a')::text);
select is((select title from workspace.board_items where id = pg_temp.rls_id('item_a')), 'A''s note',
  'same tenant, another person: an update of A''s item changes nothing');

-- Negative: another tenant ---------------------------------------------------------

select pg_temp.as_cq_app(pg_temp.rls_id('tenant_b')::text, pg_temp.rls_id('user_a')::text);
select is((select count(*)::int from workspace.board_items), 0,
  'A''s user id under tenant B: nothing (tenant B''s rows are not A''s, A''s are not tenant B''s)');
select pg_temp.as_cq_app(pg_temp.rls_id('tenant_b')::text, pg_temp.rls_id('user_b')::text);
select is((select count(*)::int from workspace.board_items where tenant_id = pg_temp.rls_id('tenant_a')), 0,
  'user B: tenant A''s items are invisible');
select is((select count(*)::int from workspace.board_item_events where tenant_id = pg_temp.rls_id('tenant_a')), 0,
  'user B: tenant A''s history is invisible');
select throws_ok(
  $$ insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('item_a'), 9, 'EDITED', 'PERSON') $$,
  '42501', null, 'user B: cannot write tenant A''s history');

-- Negative: no claims, a malformed claim -------------------------------------------

select pg_temp.as_cq_app(null, null);
select is((select count(*)::int from workspace.board_items), 0, 'no claims: nothing is visible');
select pg_temp.as_cq_app('not-a-uuid', pg_temp.rls_id('user_a')::text);
select is((select count(*)::int from workspace.board_items), 0, 'a malformed tenant claim: nothing is visible');

-- Negative: a revoked grant --------------------------------------------------------

select pg_temp.reset_test_identity();
revoke select, insert, update on workspace.board_items from cq_app;
select pg_temp.as_cq_app(pg_temp.rls_id('tenant_a')::text, pg_temp.rls_id('user_a')::text);
select throws_ok($$ select count(*) from workspace.board_items $$,
  '42501', null, 'revoked grant: even the owner''s read is refused');
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'NOTE', 'after revoke', 4, 'PERSON', gen_random_uuid()) $$,
  '42501', null, 'revoked grant: even the owner''s write is refused');

-- Unchanged today: the browser role still reaches nothing --------------------------

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from workspace.board_items $$,
  '42501', null, 'authenticated (the browser) still holds nothing on workspace');

select * from finish();

rollback;
