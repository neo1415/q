-- RECOVERY F3 (20261220190000): relationship events and audit records
-- cannot be rewritten, by any role. The services run as postgres, which
-- bypasses RLS, so this suite runs as the owner on purpose: grants say
-- nothing about it, only the triggers do.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

-- The guards exist and are enabled -----------------------------------------
select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid in ('network.relationship_events'::regclass,
                        'audit.material_actions'::regclass,
                        'audit.security_events'::regclass)
      and t.tgfoid = 'private.history_append_only()'::regprocedure
      and t.tgenabled = 'O'),
  6, 'an UPDATE and a TRUNCATE guard on each of the three history tables, enabled');

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'private.history_append_only()'::regprocedure),
  'the guard pins an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.history_append_only()', 'execute'),
  'authenticated cannot execute the guard directly');

-- Fixtures, as the owner -----------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000008950c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Guard Company', 'guard-company-895');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000008950e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Guard Investor');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000895ab1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000008950c1', '00000000-0000-4000-8000-0000008950e2');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-000000895ab2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000895ab1', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'investor_private', '{}', 'cor_00000000-0000-4000-8000-000000895003');
insert into audit.material_actions
  (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
values ('00000000-0000-4000-8000-000000895011', pg_temp.rls_id('tenant_a'),
        'capital_q_system', 'f3.guard_check', 'test', 'f3', now(), 'SUCCEEDED');
insert into audit.security_events
  (event_id, tenant_id, event_type, severity, occurred_at)
values ('00000000-0000-4000-8000-000000895012', pg_temp.rls_id('tenant_a'),
        'f3_guard_check', 'INFO', now());

select is((select count(*)::int from audit.material_actions
            where event_id = '00000000-0000-4000-8000-000000895011'), 1,
  'inserts still work: history is append-only, not read-only');

-- Rewrites are refused, even for the bypass-RLS owner --------------------------
select throws_ok($$ update audit.material_actions set outcome = 'DENIED'
                     where event_id = '00000000-0000-4000-8000-000000895011' $$,
  '55000', null, 'the owner cannot rewrite a material action');
select throws_ok($$ update audit.security_events set severity = 'HIGH'
                     where event_id = '00000000-0000-4000-8000-000000895012' $$,
  '55000', null, 'the owner cannot rewrite a security event');
select throws_ok($$ update network.relationship_events set visibility_scope = visibility_scope
                     where id = '00000000-0000-4000-8000-000000895ab2' $$,
  '55000', null, 'the owner cannot rewrite relationship history, even to the same value');
select throws_ok($$ truncate audit.material_actions $$,
  '55000', null, 'the owner cannot truncate material actions');
select throws_ok($$ truncate audit.security_events $$,
  '55000', null, 'the owner cannot truncate security events');
select throws_ok($$ truncate network.relationship_events cascade $$,
  '55000', null, 'the owner cannot truncate relationship history');

-- What browsers could never do, they still cannot (grants fire first) ------------
set local role authenticated;
select throws_ok($$ update audit.material_actions set outcome = 'DENIED' $$,
  '42501', null, 'authenticated is still refused by privilege before the guard');
reset role;

select is((select outcome from audit.material_actions
            where event_id = '00000000-0000-4000-8000-000000895011'), 'SUCCEEDED',
  'the record reads as it was written');
select is((select visibility_scope from network.relationship_events
            where id = '00000000-0000-4000-8000-000000895ab2'), 'investor_private',
  'the relationship event reads as it was written');

select * from finish();
rollback;
