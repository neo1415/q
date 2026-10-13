-- Durable GateQ exchange and immutable submitted dossier boundary.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(10);
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


select has_column('gateq', 'applications', 'interview_outcome', 'model outcome checkpoint exists');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'gateq' and table_name = 'applications' and grantee in ('anon', 'authenticated')), 0, 'claims add no browser grant');
select throws_ok($$update gateq.applications set interview_claim_id = gen_random_uuid() where id = '00000000-0000-4000-8000-00000000dd31'$$, '23514', null, 'a claim needs expiry and a turn key');
update gateq.applications set interview_claim_id = gen_random_uuid(), interview_claim_turn_id = 'exchange-1', interview_claim_expires_at = now() + interval '5 minutes' where id = '00000000-0000-4000-8000-00000000dd31';
select throws_ok($$update gateq.applications set status = 'SUBMITTED', submitted_at = now() where id = '00000000-0000-4000-8000-00000000dd31'$$, '23514', null, 'pending exchange blocks submission');
select throws_ok($$update gateq.applications set interview_outcome = '[]'::jsonb where id = '00000000-0000-4000-8000-00000000dd31'$$, '23514', null, 'checkpoint must be an object');
select lives_ok($$update gateq.applications set interview_outcome = '{"reply":"Review your disclosure."}'::jsonb where id = '00000000-0000-4000-8000-00000000dd31'$$, 'checkpoint persists before finalization');
select lives_ok($$update gateq.applications set interview_claim_id = null, interview_claim_turn_id = null, interview_claim_expires_at = null, interview_outcome = null, status = 'SUBMITTED', submitted_at = now() where id = '00000000-0000-4000-8000-00000000dd31'$$, 'completed exchange permits submission');
select throws_ok($$insert into gateq.application_turns(application_id, tenant_id, seq, role, text, client_turn_id) values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 1, 'Q', 'Late reply', 'late-turn')$$, '23001', null, 'late model reply cannot appear after submission');
select throws_ok($$insert into gateq.application_facts(application_id, tenant_id, dimension, value, provenance) values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 'company.name', '{"kind":"TEXT","text":"Late edit"}', 'APPLICANT_PROVIDED')$$, '23001', null, 'facts cannot be changed after submission');
select throws_ok($$insert into gateq.application_turns(application_id, tenant_id, seq, role, text, client_turn_id) values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_a'), 1, 'Q', 'Wrong tenant', 'wrong-tenant')$$, '23514', null, 'cross-tenant application writes are refused');
select * from finish();
rollback;
