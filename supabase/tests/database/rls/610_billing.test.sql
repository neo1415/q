-- BILLING · billing.* (migration 20261116010000, ADR 0034).
--
-- Server-only: no client role reads or writes any of it -- not an active
-- member of the organisation whose plan it is (positive path is the
-- server, through the API), not a member of another tenant, not a revoked
-- member, not anon. The catalogue has exactly one launch default; history
-- (usage, assignments, overrides, fee entries) is never rewritten; and
-- billing.consume is idempotent and refuses past the limit.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (packages/billing + the API decide the account
-- from the server-resolved actor context).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Shape ------------------------------------------------------------------------
select has_schema('billing', 'billing schema exists');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'billing' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is on for every billing table');
select is(
  (select count(*)::int from pg_policies where schemaname = 'billing'),
  0, 'no RLS policy exists for any client role');
select ok(not has_schema_privilege('anon', 'billing', 'usage')
      and not has_schema_privilege('authenticated', 'billing', 'usage'),
  'no client role has usage on billing');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema = 'billing'),
  0, 'no client role holds any privilege on billing tables');
select ok(not has_function_privilege('authenticated',
  'billing.consume(uuid, uuid, text, integer, integer, text, uuid, text, date)', 'execute'),
  'a client cannot call the meter');
select is((select count(*)::int from billing.plans where is_launch_default), 1,
  'exactly one launch default plan');
select is((select key from billing.plans where is_launch_default), 'launch',
  'every account without an assignment is on Launch');
select throws_ok(
  $$update billing.plans set is_launch_default = true where key = 'free'$$,
  '23505', null, 'a second launch default is refused');

-- The meter (server role) --------------------------------------------------------
select is(
  (select outcome from billing.consume(pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'q.rehearsals', 1, 1,
     'pgtap-key-0001', pg_temp.rls_id('user_a'), 'API', date_trunc('month', now())::date)),
  'CONSUMED', 'the first unit is recorded');
select is(
  (select outcome from billing.consume(pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'q.rehearsals', 1, 1,
     'pgtap-key-0001', pg_temp.rls_id('user_a'), 'API', date_trunc('month', now())::date)),
  'REPLAYED', 'the same idempotency key is not counted twice');
select is(
  (select outcome from billing.consume(pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'q.rehearsals', 1, 1,
     'pgtap-key-0002', pg_temp.rls_id('user_a'), 'API', date_trunc('month', now())::date)),
  'LIMIT_REACHED', 'a new unit past the limit is refused');
select is(
  (select count(*)::int from billing.usage_events where account_key = 'o:' || pg_temp.rls_id('org_a')::text),
  1, 'only one unit was recorded');
select is(
  (select outcome from billing.consume(pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'q.rehearsals', 1, 1,
     'pgtap-key-0002', pg_temp.rls_id('user_b'), 'API', date_trunc('month', now())::date)),
  'CONSUMED', 'another organisation has its own meter');
select throws_ok(
  $$update billing.usage_events set quantity = 9$$,
  '23001', null, 'usage is never rewritten');
select throws_ok(
  $$delete from billing.usage_events$$,
  '23001', null, 'usage is never deleted');

-- Assignments -------------------------------------------------------------------
insert into billing.plan_assignments (organisation_id, plan_id, source, assigned_by_user_id, reason)
  select pg_temp.rls_id('org_a'), id, 'ADMIN', pg_temp.rls_id('user_b'), 'Fixture: free plan'
    from billing.plans where key = 'free';
select throws_ok(
  $$insert into billing.plan_assignments (organisation_id, plan_id, source, assigned_by_user_id, reason)
      select pg_temp.rls_id('org_a'), id, 'ADMIN', pg_temp.rls_id('user_b'), 'second current'
        from billing.plans where key = 'fund'$$,
  '23505', null, 'an account has one current assignment');
select throws_ok(
  $$update billing.plan_assignments set reason = 'rewritten'$$,
  '23001', null, 'an assignment is superseded, never rewritten');

-- Client roles -------------------------------------------------------------------
select pg_temp.act_as('auth_a');
select throws_ok($$select count(*) from billing.plan_assignments$$, '42501', null,
  'an active member does not read billing tables directly (the API decides)');
select pg_temp.act_as('auth_b');
select throws_ok($$select count(*) from billing.usage_events$$, '42501', null,
  'a member of another tenant reads nothing');
select pg_temp.act_as('auth_r');
select throws_ok($$insert into billing.limit_overrides (organisation_id, feature_key, limit_value, granted_by_user_id, reason)
                   values (pg_temp.rls_id('org_r'), 'q.rehearsals', 999, pg_temp.rls_id('user_r'), 'self grant')$$,
  '42501', null, 'a revoked member cannot grant themselves a limit');
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from billing.fee_entries$$, '42501', null,
  'the anonymous role reads nothing');

select * from finish();
rollback;
