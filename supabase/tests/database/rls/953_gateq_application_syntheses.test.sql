-- Q's reading of a GateQ submission: server-only, one per application, never
-- rewritten once READY, never bound across tenants.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(9);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Synthesis Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb01', pg_temp.rls_id('org_b'),
   'gq_3456789abcdefghjkmnpqrs09a', 'Seed programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000fb21', '00000000-0000-4000-8000-00000000fb11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000fb11',
   '00000000-0000-4000-8000-00000000fb21', 'ga_3456789abcdefghjkmnpqrs09a');

select throws_ok($$insert into gateq.application_syntheses (application_id, tenant_id, status)
  values ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_a'), 'FAILED')$$,
  '23503', null, 'a reading cannot claim another tenant''s application');
select throws_ok($$insert into gateq.application_syntheses (application_id, tenant_id, status)
  values ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), 'READY')$$,
  '23514', null, 'READY always carries the reading');
select lives_ok($$insert into gateq.application_syntheses (application_id, tenant_id, status)
  values ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), 'FAILED')$$,
  'a failed attempt is recorded');
select lives_ok($$update gateq.application_syntheses set attempts = 2, updated_at = now()
  where application_id = '00000000-0000-4000-8000-00000000fb31'$$, 'a failed attempt may be retried');
select lives_ok($$update gateq.application_syntheses
  set status = 'READY', synthesis = '{"schemaVersion":1}'::jsonb, attempts = 3, prompt_version = 'GATEQ_DOSSIER_SYNTHESIS@v1'
  where application_id = '00000000-0000-4000-8000-00000000fb31'$$, 'and completed once');
select throws_ok($$update gateq.application_syntheses set synthesis = '{"schemaVersion":1,"edited":true}'::jsonb
  where application_id = '00000000-0000-4000-8000-00000000fb31'$$,
  '23514', null, 'a READY reading is never rewritten');
select throws_ok($$insert into gateq.application_syntheses (application_id, tenant_id, status)
  values ('00000000-0000-4000-8000-00000000fb31', pg_temp.rls_id('tenant_b'), 'FAILED')$$,
  '23505', null, 'one reading per application');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema = 'gateq' and table_name = 'application_syntheses' and grantee in ('anon', 'authenticated')),
  0, 'no browser grants');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'gateq' and c.relname = 'application_syntheses'), 'RLS on, no policy needed for a server-only table');
select * from finish();
rollback;
