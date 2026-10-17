-- Premium projections never have a browser SELECT policy, including company owners.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(27);
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
select is((select count(*)::int from billing.plan_features pf join billing.plans p on p.id=pf.plan_id where pf.feature_key='intelligence.unicorn_potential' and pf.included and p.key not in ('founder_pro','investor_pro','fund')),0,'no free or default plan silently entitled');
select is((select count(*)::int from billing.plan_features pf join billing.plans p on p.id=pf.plan_id where pf.feature_key='intelligence.unicorn_potential' and pf.included and p.key in ('founder_pro','investor_pro','fund')),3,'founder pro, investor pro and fund plans entitled');
-- A→B→A remains legal history; only adjacent identical basis is skipped by
-- the transactional repository, never a global unique hash constraint.
insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations)
select tenant_id,organisation_id,company_id,method_version,2,repeat('b',64),cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1;
insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations)
select tenant_id,organisation_id,company_id,method_version,3,repeat('a',64),cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1;
select is((select count(*)::int from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1'),3,'A to B to A appends all three historical snapshots');
select throws_ok($$insert into core.company_unicorn_potential_assessments(tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations) select tenant_id,organisation_id,company_id,method_version,revision,basis_hash,cohort_key,status,summary,observations from core.company_unicorn_potential_assessments where company_id='00000000-0000-4000-8000-0000000098c1' and revision=1$$,'23505',null,'same revision cannot be duplicated');

-- Exercise the actual source predicate used by the TypeScript repository.
insert into knowledge.company_profiles(company_id, company_tenant_id, listed, visibility, canonical_name, fingerprint, version)
values ('00000000-0000-4000-8000-0000000098c1', pg_temp.rls_id('tenant_a'), true, 'network_visible', 'Unicorn Test', 'fixture', 1)
on conflict (company_id) do update set listed = excluded.listed, visibility = excluded.visibility,
  canonical_name = excluded.canonical_name, fingerprint = excluded.fingerprint;
create temporary table unicorn_candidates as select jsonb_build_array(jsonb_build_object('company_id', '00000000-0000-4000-8000-0000000098c1', 'revision', 1, 'assessed_at', clock_timestamp() + interval '1 second', 'observations', '[]'::jsonb)) as value;
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 1, 'listed active company with no contributing evidence remains insufficient, not denied');
select ok(not has_function_privilege('authenticated', 'private.unicorn_potential_eligible_revisions(jsonb)', 'execute'), 'browser cannot call source eligibility oracle');
select ok(not has_function_privilege('anon', 'private.unicorn_potential_eligible_revisions(jsonb)', 'execute'), 'anonymous cannot call source eligibility oracle');
select ok(has_function_privilege('service_role', 'private.unicorn_potential_eligible_revisions(jsonb)', 'execute'), 'trusted worker can reauthorize batch');
update unicorn_candidates set value = jsonb_set(value, '{0,observations}', '[{"source":{"kind":"UNKNOWN"}}]');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'unknown source kind cannot silently authorize a snapshot');
update unicorn_candidates set value = jsonb_set(value, '{0,observations}', '{}'::jsonb);
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'malformed observation object fails closed');
insert into evidence.claims(id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, asserted_by_type, asserted_by_id, asserted_at, truth_class, evidence_status, lifecycle_status, visibility_scope, current_revision_id)
values ('00000000-0000-4000-8000-0000000098c2', pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000098c1', 'test', 'unicorn.test', 'Annual recurring revenue doubled in October 2026', 'SYSTEM', pg_temp.rls_id('user_a'), '2026-10-17T00:00:00Z', 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'network_visible', '00000000-0000-4000-8000-0000000098c3');
insert into evidence.claim_revisions(id, tenant_id, claim_id, revision_number, statement, truth_class, evidence_status, lifecycle_status, changed_by_type, changed_by_id)
values ('00000000-0000-4000-8000-0000000098c3', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000098c2', 1, 'Annual recurring revenue doubled in October 2026', 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'SYSTEM', pg_temp.rls_id('user_a'));
update unicorn_candidates set value = jsonb_set(value, '{0,observations}', '[{"source":{"kind":"CLAIM","id":"00000000-0000-4000-8000-0000000098c2","label":"Annual recurring revenue doubled in October 2026","revision":"2026-10-17T00:00:00Z","truthClass":"USER_CLAIM","evidenceStatus":"SELF_REPORTED","lifecycleStatus":"CURRENT"}}]');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 1, 'current network claim authorizes its original self-reported source');
update evidence.claims set visibility_scope = 'founder_private' where id = '00000000-0000-4000-8000-0000000098c2';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'withdrawing claim visibility immediately invalidates previously persisted score');
update evidence.claims set visibility_scope = 'network_visible' where id = '00000000-0000-4000-8000-0000000098c2';
update unicorn_candidates set value = jsonb_set(value, '{0,observations,0,source,label}', '"Different revenue claim"'::jsonb);
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'changed source statement cannot authorize an older explanation');
update unicorn_candidates set value = jsonb_set(value, '{0,observations}', '[]'::jsonb);
update core.companies set marketplace_visibility = 'founder_private' where id = '00000000-0000-4000-8000-0000000098c1';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'withdrawn company fails closed even with no claim references');
update core.companies set marketplace_visibility = 'network_visible' where id = '00000000-0000-4000-8000-0000000098c1';
update core.companies set company_status = 'closed' where id = '00000000-0000-4000-8000-0000000098c1';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'closed canonical company cannot expose its old score');
update core.companies set company_status = 'active' where id = '00000000-0000-4000-8000-0000000098c1';
update unicorn_candidates set value = jsonb_set(value, '{0,assessed_at}', to_jsonb((clock_timestamp() - interval '1 day')::text));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_candidates))), 0, 'profile revision newer than snapshot requires recomputation');
select * from finish();
rollback;
