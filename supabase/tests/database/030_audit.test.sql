-- CQ-SEC-003 · audit schema structure, invariants, and access posture.
-- Synthetic fixtures only; rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- Structure -----------------------------------------------------------------

select has_schema('audit', 'audit schema exists');
select has_table('audit', 'material_actions', 'audit.material_actions exists');
select has_table('audit', 'security_events', 'audit.security_events exists');
select hasnt_column('audit', 'material_actions', 'updated_at', 'material_actions is append-oriented: no updated_at');
select hasnt_column('audit', 'security_events', 'updated_at', 'security_events is append-oriented: no updated_at');
select col_is_unique('audit', 'material_actions', 'event_id', 'material_actions.event_id is unique');
select col_is_unique('audit', 'security_events', 'event_id', 'security_events.event_id is unique');
select has_index('audit', 'material_actions', 'material_actions_tenant_time_idx', 'tenant/time index exists');
select has_index('audit', 'material_actions', 'material_actions_resource_time_idx', 'resource/time index exists');
select has_index('audit', 'security_events', 'security_events_type_time_idx', 'security event type/time index exists');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'audit' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS enabled on every audit table');

-- Privileges ----------------------------------------------------------------

select ok(not has_schema_privilege('anon', 'audit', 'usage'), 'anon has no usage on audit');
select ok(not has_schema_privilege('authenticated', 'audit', 'usage'), 'authenticated has no usage on audit');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'audit'),
  0, 'no client role holds any privilege on audit tables');

-- Invariants (as owner) -----------------------------------------------------

insert into auth.users (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
insert into identity.tenants (id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Synthetic Tenant');

select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'human', 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '23514', null, 'a human action without actor_id is rejected');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, actor_id, authority_user_id, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'human',
             (select id from identity.user_profiles where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
             gen_random_uuid(), 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '23514', null, 'a human action under another authority is rejected');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'q', 'q.action.executed', 'q_action', 'x', now(), 'SUCCEEDED') $$,
  '23514', null, 'a Q action without human authority is rejected');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'capital_q_system', 'permission.granted', 'permission', 'x', now(), 'PENDING') $$,
  '23514', null, 'an invented outcome is rejected');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'robot', 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '23514', null, 'an invented actor type is rejected');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'capital_q_system', 'grant_permission', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '23514', null, 'a non-dotted action type is rejected');
select lives_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'capital_q_system', 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  'a well-formed system action inserts');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'capital_q_system', 'permission.revoked', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '23505', null, 'a duplicate audit event_id is rejected');
select throws_ok(
  $$ insert into audit.security_events (event_id, event_type, severity, occurred_at)
     values (gen_random_uuid(), 'permission_denied', 'PANIC', now()) $$,
  '23514', null, 'an invented severity is rejected');
select lives_ok(
  $$ insert into audit.security_events (event_id, event_type, severity, occurred_at, ip_hash)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'rate_limit_triggered', 'LOW', now(), 'sha256:9f86d081884c7d65') $$,
  'a tenant-less security event inserts');

-- Client roles: no read, no write, no rewrite ---------------------------------

set local role authenticated;
select throws_ok($$ select * from audit.material_actions $$, '42501', null, 'authenticated cannot read material actions');
select throws_ok($$ select * from audit.security_events $$, '42501', null, 'authenticated cannot read security events');
select throws_ok(
  $$ insert into audit.material_actions (event_id, tenant_id, actor_type, action_type, resource_type, resource_id, occurred_at, outcome)
     values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'capital_q_system', 'permission.granted', 'permission', 'x', now(), 'SUCCEEDED') $$,
  '42501', null, 'authenticated cannot insert material actions');
select throws_ok($$ update audit.material_actions set outcome = 'DENIED' $$, '42501', null, 'authenticated cannot rewrite material actions');
select throws_ok($$ delete from audit.material_actions $$, '42501', null, 'authenticated cannot delete material actions');
select throws_ok($$ update audit.security_events set severity = 'INFO' $$, '42501', null, 'authenticated cannot rewrite security events');
select throws_ok($$ delete from audit.security_events $$, '42501', null, 'authenticated cannot delete security events');
reset role;

set local role anon;
select throws_ok($$ select * from audit.material_actions $$, '42501', null, 'anon cannot read material actions');
reset role;

select * from finish();

rollback;
