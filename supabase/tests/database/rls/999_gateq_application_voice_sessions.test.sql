-- GateQ voice interview sessions: server-only, fixed clock, immutable end.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(9);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Voice Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs0b', 'Seed programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fb21', '00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb11',
   '00000000-0000-4000-8000-00000000fb21', 'ga_23456789abcdefghjkmnpqrs0b');

select lives_ok($$insert into gateq.application_voice_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, ends_at)
  values ('00000000-0000-4000-8000-00000000fb41', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb31',
          repeat('a',64), 'sealed:v1:opaque', 180, now() + interval '180 seconds')$$,
  'a session binds to its application and tenant with a fixed end');
select throws_ok($$insert into gateq.application_voice_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, ends_at)
  values ('00000000-0000-4000-8000-00000000fb42', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000fb31',
          repeat('b',64), 'sealed:v1:opaque', 180, now() + interval '180 seconds')$$,
  '23503', null, 'a session cannot claim another tenant''s application');
select throws_ok($$insert into gateq.application_voice_sessions
  (id, tenant_id, application_id, bridge_token_hash, guest_credential_sealed, max_seconds, ends_at)
  values ('00000000-0000-4000-8000-00000000fb43', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb31',
          repeat('c',64), 'sealed:v1:opaque', 180, now() + interval '600 seconds')$$,
  '23514', null, 'the end can never exceed the session''s own cap');
select throws_ok($$update gateq.application_voice_sessions set ends_at = ends_at + interval '1 minute'
  where id = '00000000-0000-4000-8000-00000000fb41'$$,
  '23514', null, 'the clock never moves');
select lives_ok($$update gateq.application_voice_sessions set bridge_token_hash = repeat('d',64)
  where id = '00000000-0000-4000-8000-00000000fb41'$$, 'a reconnect replaces the line bearer of a live session');
select lives_ok($$update gateq.application_voice_sessions set status = 'ENDED', ended_reason = 'CONTINUED_BY_TYPING', ended_at = now()
  where id = '00000000-0000-4000-8000-00000000fb41'$$, 'it ends with a reason');
select throws_ok($$update gateq.application_voice_sessions set status = 'LIVE', ended_reason = null, ended_at = null
  where id = '00000000-0000-4000-8000-00000000fb41'$$,
  '23514', null, 'an ended session never reopens');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema = 'gateq' and table_name = 'application_voice_sessions' and grantee in ('anon', 'authenticated')),
  0, 'no browser grants');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'gateq' and c.relname = 'application_voice_sessions'), 'RLS on, no policy needed for a server-only table');
select * from finish();
rollback;
