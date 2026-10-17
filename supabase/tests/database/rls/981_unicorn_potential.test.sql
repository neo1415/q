-- Premium projections never have a browser SELECT policy, including company owners.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(15);
insert into core.companies(id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, short_description, marketplace_visibility)
values ('00000000-0000-4000-8000-0000000098c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Unicorn Test', 'unicorn-test', 'seed', 'Test', 'network_visible');
insert into core.company_unicorn_potential_assessments(tenant_id, organisation_id, company_id, method_version, revision, basis_hash, cohort_key, status, score, summary, observations)
values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000098c1', 'unicorn-potential.v1.0.0', 1, repeat('a',64), 'seed:fintech', 'INSUFFICIENT_EVIDENCE', null, '{"methodVersion":"unicorn-potential.v1.0.0","status":"INSUFFICIENT_EVIDENCE","overallScore":null}', '{}');
select is((select count(*)::int from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1'),1,'insufficient evidence persists as null, never zero');
select throws_ok($$update core.company_unicorn_potential_assessments set revision=2 where company_id='00000000-0000-4000-8000-0000000098c1'$$,'42501',null,'history cannot be overwritten');
select throws_ok($$delete from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1'$$,'42501',null,'history cannot be deleted');
select throws_ok($$insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations) values(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('org_b'),'00000000-0000-4000-8000-0000000098c1','unicorn-potential.v1.0.0',2,repeat('b',64),'seed:fintech','INSUFFICIENT_EVIDENCE','{"methodVersion":"unicorn-potential.v1.0.0","status":"INSUFFICIENT_EVIDENCE","overallScore":null}','{}')$$,'23503',null,'false organisation rejected');
select throws_ok($$insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations) values(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('org_a'),'00000000-0000-4000-8000-0000000098c1','unicorn-potential.v1.0.0',2,repeat('b',64),'seed:fintech','INSUFFICIENT_EVIDENCE','{"methodVersion":"unicorn-potential.v1.0.0","status":"INSUFFICIENT_EVIDENCE","overallScore":null}','{}')$$,'23503',null,'cross-tenant subject rejected');
select is((select count(*)::int from pg_policies where schemaname='core' and tablename='company_unicorn_potential_assessments'),0,'no direct browser policy can bypass premium service');
select ok(not has_table_privilege('authenticated','core.company_unicorn_potential_assessments','select'),'authenticated cannot read any company raw score');
select ok(not has_table_privilege('anon','core.company_unicorn_potential_assessments','select'),'anonymous cannot read raw score');
select ok(not has_table_privilege('authenticated','core.company_unicorn_potential_assessments','insert'),'browser cannot write scores');
select ok((select relrowsecurity from pg_class where oid='core.company_unicorn_potential_assessments'::regclass),'RLS enabled');
select is((select kind from billing.features where key='intelligence.unicorn_potential'),'ACCESS','premium feature registered');
select is((select count(*)::int from billing.plan_features pf join billing.plans p on p.id=pf.plan_id where pf.feature_key='intelligence.unicorn_potential' and pf.included and p.key not in ('investor_pro','fund')),0,'no free or default plan silently entitled');
select ok((select bool_and(pf.included) from billing.plan_features pf join billing.plans p on p.id=pf.plan_id where pf.feature_key='intelligence.unicorn_potential' and p.key in ('investor_pro','fund')),'pro and fund plans entitled');
-- A→B→A remains legal history; only adjacent identical basis is skipped by
-- the transactional repository, never a global unique hash constraint.
insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations)
select tenant_id,organisation_id,company_id,method_version,2,repeat('b',64),cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1;
insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations)
select tenant_id,organisation_id,company_id,method_version,3,repeat('a',64),cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1;
select is((select count(*)::int from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1'),3,'A to B to A appends all three historical snapshots');
select throws_ok($$insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations) select tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1$$,'23505',null,'same revision cannot be duplicated');
select * from finish();
rollback;
