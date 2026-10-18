-- CQ-REC-004 · recommendation.feature_snapshots: derived, versioned,
-- immutable feature snapshots that carry an investor's private mandate
-- signals and are readable by no browser principal.
--
--   feature value ≠ weight ≠ score;  snapshot ≠ company truth ≠ investor truth
--   MISSING ≠ zero;  internal feature ≠ founder-visible fact
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, marketplace_visibility) values
  ('00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Feature Co A', 'feature-co-a', 'seed', 'NG', 'network_visible');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000008b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Feature Capital B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000008a1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', 'Seed Africa', 'ACTIVE', now(), pg_temp.rls_id('user_b'));

-- Shape ------------------------------------------------------------------------------
select has_table('recommendation', 'feature_snapshots', 'the feature snapshot store exists');
select is((select relrowsecurity from pg_class where oid = 'recommendation.feature_snapshots'::regclass), true,
  'RLS is enabled');
select is((select count(*)::int from pg_policies where schemaname = 'recommendation' and tablename = 'feature_snapshots'), 0,
  'and no policy: server-internal, never browser-reachable');

-- A snapshot ---------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.feature_snapshots
    (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    ('00000000-0000-4000-8000-0000000008f1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'INVESTOR_DISCOVER', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":["STAGE_OVERLAP"]},"semantic":null}'::jsonb,
     'CONFIDENTIAL', '[{"featureId":"declared_fit.stage","featureVersion":"v1","status":"PRESENT","value":"MATCH"}]'::jsonb,
     repeat('a', 64), now())
$$, 'a current snapshot is stored for an investor, mandate, company and context');
select throws_ok($$
  insert into recommendation.feature_snapshots
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'INVESTOR_DISCOVER', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":[]},"semantic":null}'::jsonb,
     'CONFIDENTIAL', '[{"featureId":"declared_fit.stage","status":"MISSING"}]'::jsonb, repeat('b', 64), now())
$$, '23505', null, 'one CURRENT snapshot per investor, mandate, company, context and schema version');
select throws_ok($$
  update recommendation.feature_snapshots set features = '[]'::jsonb where id = '00000000-0000-4000-8000-0000000008f1'
$$, '23514', null, 'a snapshot payload is never edited');
select throws_ok($$
  update recommendation.feature_snapshots set fingerprint = repeat('c', 64) where id = '00000000-0000-4000-8000-0000000008f1'
$$, '23514', null, 'nor its fingerprint');
select throws_ok($$
  update recommendation.feature_snapshots set sensitivity = 'PUBLIC' where id = '00000000-0000-4000-8000-0000000008f1'
$$, '23514', null, 'nor its sensitivity: a derived artifact does not get downgraded');
select throws_ok($$
  insert into recommendation.feature_snapshots
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'FOUNDER_DISCOVER', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":[]},"semantic":null}'::jsonb,
     'CONFIDENTIAL', '[{"featureId":"x"}]'::jsonb, repeat('d', 64), now())
$$, '23503', null, 'a snapshot cannot be filed under a tenant that does not own the mandate');
select throws_ok($$
  insert into recommendation.feature_snapshots
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'GATEQ', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE',
     '{"structured":null,"semantic":null}'::jsonb, 'CONFIDENTIAL', '[{"featureId":"x"}]'::jsonb, repeat('e', 64), now())
$$, '23514', null, 'a snapshot names at least one candidate generator');
select throws_ok($$
  insert into recommendation.feature_snapshots
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'GATEQ', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":[]},"semantic":null}'::jsonb,
     'CONFIDENTIAL', '{"not":"an array"}'::jsonb, repeat('f', 64), now())
$$, '23514', null, 'the payload is a bounded array of feature values, never an arbitrary object');

-- Supersession -----------------------------------------------------------------------------
select lives_ok($$
  update recommendation.feature_snapshots set status = 'SUPERSEDED', superseded_at = now() where id = '00000000-0000-4000-8000-0000000008f1'
$$, 'a snapshot can be superseded when its inputs change');
select lives_ok($$
  insert into recommendation.feature_snapshots
    (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    ('00000000-0000-4000-8000-0000000008f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 2,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 2,
     'INVESTOR_DISCOVER', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":["STAGE_OVERLAP"]},"semantic":null}'::jsonb,
     'CONFIDENTIAL', '[{"featureId":"declared_fit.stage","featureVersion":"v1","status":"PRESENT","value":"NO_MATCH"}]'::jsonb,
     repeat('9', 64), now())
$$, 'and a new current one takes its place');
select throws_ok($$
  update recommendation.feature_snapshots set status = 'CURRENT', superseded_at = null where id = '00000000-0000-4000-8000-0000000008f1'
$$, '23514', null, 'a superseded snapshot never becomes current again');
select is((select count(*)::int from recommendation.feature_snapshots where company_id = '00000000-0000-4000-8000-0000000008c1'), 2,
  'history is kept: the old snapshot still explains the slate it was ranked from');

-- Cascade ----------------------------------------------------------------------------------
select lives_ok($$ delete from core.companies where id = '00000000-0000-4000-8000-0000000008c1' $$, 'the company can be removed');
select is((select count(*)::int from recommendation.feature_snapshots where company_id = '00000000-0000-4000-8000-0000000008c1'), 0,
  'its feature snapshots go with it: derived data never outlives its canonical row');

-- Exposure ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from recommendation.feature_snapshots $$, '42501', null, 'anonymous cannot read feature snapshots');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from recommendation.feature_snapshots $$, '42501', null, 'a signed-in founder cannot read an investor''s feature vector');
select throws_ok($$ select id from recommendation.feature_snapshots limit 1 $$, '42501', null, 'not even an id');
select throws_ok($$
  insert into recommendation.feature_snapshots
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
     mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
     candidate_provenance, sensitivity, features, fingerprint, computed_at)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1', 1,
     '00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), 1,
     'INVESTOR_DISCOVER', 'recommendation-features.v1', 'eligibility.v1', 'ELIGIBLE', 'structured-mandate.v1',
     '{"structured":{"generatorVersion":"structured-mandate.v1","reasonCodes":[]},"semantic":null}'::jsonb,
     'PUBLIC', '[{"featureId":"declared_fit.stage","status":"PRESENT","value":"MATCH"}]'::jsonb, repeat('1', 64), now())
$$, '42501', null, 'a browser principal cannot submit feature values');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from recommendation.feature_snapshots where tenant_id = pg_temp.rls_id('tenant_b') $$,
  '42501', null, 'not even the investor''s own member reads the store through the database');

select * from finish();
rollback;
