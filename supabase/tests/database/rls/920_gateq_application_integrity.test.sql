-- GateQ slice 1 · the interview transcript, the applicant's contact and the
-- submission dossier: server-only, append-only where it must be, and the
-- submission still written once.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

-- Fixtures ------------------------------------------------------------------------
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

select has_column('gateq', 'applications', 'interview_claim_id', 'durable exchange claim exists');
select throws_ok($$ update gateq.applications set interview_claim_id = gen_random_uuid()
where id = '00000000-0000-4000-8000-00000000dd31' $$, '23514', null, 'claim always has a deadline');
insert into gateq.application_contacts (application_id, tenant_id, name, email, role, company_name)
values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 'Test', 'test@example.test', 'CEO', 'Test company');
insert into gateq.application_facts(id,application_id,tenant_id,dimension,value,provenance)
values('00000000-0000-4000-8000-00000000dd71','00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_b'),'company.name','{"kind":"TEXT","text":"Original"}','APPLICANT_PROVIDED');
select lives_ok($$ update gateq.application_facts set superseded_at=now(),superseded_by='00000000-0000-4000-8000-00000000dd72'
where id='00000000-0000-4000-8000-00000000dd71';
insert into gateq.application_facts(id,application_id,tenant_id,dimension,value,provenance)
values('00000000-0000-4000-8000-00000000dd72','00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_b'),'company.name','{"kind":"TEXT","text":"Corrected"}','APPLICANT_PROVIDED') $$,'real correction respects one current fact and preserves lineage');
select is((select count(*)::int from gateq.application_facts where application_id='00000000-0000-4000-8000-00000000dd31' and superseded_at is null),1,'exactly one current fact after correction');
update gateq.applications set status = 'SUBMITTED', submitted_at = now()
where id = '00000000-0000-4000-8000-00000000dd31';
select throws_ok($$ insert into gateq.application_turns(application_id,tenant_id,seq,role,text,client_turn_id)
values('00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_b'),1,'PERSON','Late turn','late') $$,
'23001',null,'late transcript append cannot rewrite frozen application');
select throws_ok($$ update gateq.application_contacts set name = 'Changed'
where application_id = '00000000-0000-4000-8000-00000000dd31' $$,
'23001',null,'contact cannot change after submission');
select throws_ok($$ insert into gateq.application_facts(application_id,tenant_id,dimension,value,provenance)
values('00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_b'),'company.name','{"kind":"TEXT","text":"Changed"}','APPLICANT_PROVIDED') $$,
'23001',null,'late facts cannot alter frozen evidence');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='gateq' and table_name='applications' and grantee in ('anon','authenticated')),0,'claims have no browser grant');
select is((select relrowsecurity from pg_class where oid='gateq.applications'::regclass),true,'application RLS retained');
select is((select count(*)::int from pg_policies where schemaname='gateq' and tablename='applications'),0,'no guest claims via database policies');
select * from finish();
rollback;
