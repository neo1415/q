-- GateQ verification counters cannot be read or changed by a browser role.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(7);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interview Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs01', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000dd21', '00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11',
   '00000000-0000-4000-8000-00000000dd21', 'ga_23456789abcdefghjkmnpqrs01');


select has_table('gateq', 'contact_verification_limits', 'shared counters exist');
select has_column('gateq', 'application_contacts', 'attempt_window_started_at', 'resend window persists');
select is((select relrowsecurity from pg_class where oid = 'gateq.contact_verification_limits'::regclass), true, 'counter RLS is enabled');
select is((select count(*)::int from pg_policies where schemaname = 'gateq' and tablename = 'contact_verification_limits'), 0, 'no browser policy');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'gateq' and table_name = 'contact_verification_limits' and grantee in ('anon', 'authenticated')), 0, 'no browser grant');
select throws_ok($$insert into gateq.contact_verification_limits(scope,key_hash) values ('DESTINATION','founder@example.test')$$, '23514', null, 'plaintext destination cannot be stored');
select throws_ok($$insert into gateq.contact_verification_limits(scope,key_hash,attempt_count) values ('DESTINATION',repeat('a',64),21)$$, '23514', null, 'counter cannot exceed maximum destination allowance');
select * from finish();
rollback;
