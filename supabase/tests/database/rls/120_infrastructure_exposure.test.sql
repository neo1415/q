-- CQ-SEC-004 · internal infrastructure stays out of reach of browser
-- principals: the outbox, the queue, the audit tables and the tenant
-- mapping. These are not "less sensitive"; they are server-only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Seed one row of each internal kind as the privileged role.
insert into events.outbox (event_id, event_type, event_version, payload)
values ('00000000-0000-4000-8000-0000000000e1', 'test.fixture.created', 1, '{"id":"x"}'::jsonb);
insert into audit.material_actions
  (event_id, tenant_id, actor_type, actor_id, authority_user_id, organisation_id, action_type, resource_type, resource_id, occurred_at, outcome)
values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_a'), 'human', pg_temp.rls_id('user_a'), pg_temp.rls_id('user_a'),
   pg_temp.rls_id('org_a'), 'organisation.member.changed', 'membership', pg_temp.rls_id('membership_a')::text, now(), 'SUCCEEDED');
insert into audit.security_events (event_id, tenant_id, user_id, event_type, severity, occurred_at)
values ('00000000-0000-4000-8000-0000000000e3', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'permission_denied', 'MEDIUM', now());

-- Authenticated (the tenant's own member) -------------------------------------

select pg_temp.act_as_user_a();
select throws_ok($$ select * from events.outbox $$, '42501', null, 'outbox: authenticated cannot read');
select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload) values (gen_random_uuid(), 'test.fixture.created', 1, '{}'::jsonb) $$,
  '42501', null, 'outbox: authenticated cannot write');
select throws_ok($$ update events.outbox set published_at = now() $$, '42501', null, 'outbox: authenticated cannot mark published');
select throws_ok($$ select * from audit.material_actions $$, '42501', null, 'audit: authenticated cannot read own tenant''s material actions');
select throws_ok($$ select * from audit.security_events $$, '42501', null, 'audit: authenticated cannot read security events');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), pg_temp.rls_id('tenant_a'), 'capital_q_system', 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '42501', null, 'audit: authenticated cannot write material actions');
select throws_ok($$ update audit.material_actions set outcome = 'DENIED' $$, '42501', null, 'audit: authenticated cannot rewrite');
select throws_ok($$ delete from audit.security_events $$, '42501', null, 'audit: authenticated cannot delete');
select throws_ok($$ select * from identity.tenant_organisations $$, '42501', null, 'tenant mapping: authenticated cannot read');
select throws_ok($$ select * from pgmq.meta $$, '42501', null, 'queue: authenticated cannot read pgmq metadata');
select throws_ok($$ select pgmq.send('domain-events', '{}'::jsonb) $$, '42501', null, 'queue: authenticated cannot send');
select throws_ok($$ select * from pgmq.read('domain-events', 1, 1) $$, '42501', null, 'queue: authenticated cannot read');

-- Anonymous ------------------------------------------------------------------

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from events.outbox $$, '42501', null, 'outbox: anon cannot read');
select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload) values (gen_random_uuid(), 'test.fixture.created', 1, '{}'::jsonb) $$,
  '42501', null, 'outbox: anon cannot write');
select throws_ok($$ select * from audit.material_actions $$, '42501', null, 'audit: anon cannot read');
select throws_ok($$ select * from audit.security_events $$, '42501', null, 'audit: anon cannot read security events');
select throws_ok($$ select pgmq.send('domain-events', '{}'::jsonb) $$, '42501', null, 'queue: anon cannot send');

-- service_role: BYPASSRLS, but no grants on Capital Q schemas -----------------

select pg_temp.act_as_service_role();
select throws_ok($$ select * from events.outbox $$, '42501', null, 'service_role: no grant on the outbox');
select throws_ok($$ select * from audit.material_actions $$, '42501', null, 'service_role: no grant on audit');

-- Privileged server role: sees the rows (EXPECTED DB BEHAVIOR; APPLICATION
-- AUTHORIZATION IS STILL REQUIRED).
select pg_temp.act_as_privileged();
select is((select count(*)::int from events.outbox where event_id = '00000000-0000-4000-8000-0000000000e1'), 1,
  'privileged: outbox row visible to the server role');
select is((select count(*)::int from audit.material_actions where event_id = '00000000-0000-4000-8000-0000000000e2'), 1,
  'privileged: audit row visible to the server role');
select is((select count(*)::int from audit.security_events where event_id = '00000000-0000-4000-8000-0000000000e3'), 1,
  'privileged: security event visible to the server role');

select * from finish();

rollback;
