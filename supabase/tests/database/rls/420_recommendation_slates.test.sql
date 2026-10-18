-- CQ-REC-006 · recommendation.slates, slate_items and refresh_requests:
-- precomputed, durable, immutable recommendation slates with one CURRENT
-- and one BUILDING slate per investor organisation, mandate and context,
-- readable by no browser principal.
--
--   slate ≠ company truth ≠ investor truth ≠ relationship ≠ interest ≠ match
--   slate item ≠ explanation;  internal score ≠ public number
--   an old valid slate or a new complete one, never a partial set
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(40);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, marketplace_visibility) values
  ('00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Slate Co A', 'slate-co-a', 'seed', 'NG', 'network_visible'),
  ('00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Slate Co A2', 'slate-co-a2', 'seed', 'NG', 'network_visible');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000009b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Slate Capital B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000009a1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', 'Seed Africa', 'ACTIVE', now(), pg_temp.rls_id('user_b'));
insert into recommendation.feature_snapshots
  (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, company_id, company_tenant_id, company_projection_version,
   mode, feature_schema_version, eligibility_policy_version, eligibility_decision, structured_generator_version,
   candidate_provenance, sensitivity, features, fingerprint, computed_at)
values
  ('00000000-0000-4000-8000-0000000009f1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
   '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 1,
   'INVESTOR_DISCOVER', 'recommendation-features.v1', 'eligibility.v2', 'ELIGIBLE', 'structured-mandate.v2',
   '{"structured":{"generatorVersion":"structured-mandate.v2","reasonCodes":["STAGE_OVERLAP"]},"semantic":null}'::jsonb,
   'CONFIDENTIAL', '[{"featureId":"declared_fit.stage","featureVersion":"v1","status":"PRESENT","value":"MATCH"}]'::jsonb,
   repeat('a', 64), now());

-- Shape ------------------------------------------------------------------------------
select has_table('recommendation', 'slates', 'the slate store exists');
select has_table('recommendation', 'slate_items', 'and its items');
select has_table('recommendation', 'refresh_requests', 'and the refresh claim row');
select is((select bool_and(relrowsecurity) from pg_class where oid in ('recommendation.slates'::regclass, 'recommendation.slate_items'::regclass, 'recommendation.refresh_requests'::regclass)), true,
  'RLS is enabled on all three');
select is((select count(*)::int from pg_policies where schemaname = 'recommendation' and tablename in ('slates', 'slate_items', 'refresh_requests')), 0,
  'and no policy: server-internal, never browser-reachable');
select is((select count(*)::int from pgmq.list_queues() where queue_name in ('recommendation-refresh', 'recommendation-refresh-dead')), 2,
  'the refresh queue and its dead letter exist');

-- A build ---------------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.slates
    (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
     eligibility_policy_version, structured_generator_version, semantic_generator_version,
     feature_schema_version, ranker_version, ranking_config_version, taxonomy_version)
  values
    ('00000000-0000-4000-8000-0000000009e1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
     'INVESTOR_DISCOVER', 'eligibility.v2', 'structured-mandate.v2', null,
     'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1', '{"sector":3}'::jsonb)
$$, 'a slate starts BUILDING with every pipeline version on the row');
select is((select status from recommendation.slates where id = '00000000-0000-4000-8000-0000000009e1'), 'BUILDING', 'status defaults to BUILDING');
select throws_ok($$
  insert into recommendation.slates
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
     eligibility_policy_version, structured_generator_version, feature_schema_version, ranker_version, ranking_config_version)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
     'INVESTOR_DISCOVER', 'eligibility.v2', 'structured-mandate.v2', 'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1')
$$, '23505', null, 'one BUILDING slate per investor, mandate and context: a concurrent claim is refused');
select throws_ok($$
  insert into recommendation.slates
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
     eligibility_policy_version, structured_generator_version, feature_schema_version, ranker_version, ranking_config_version)
  values
    (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
     'GATEQ', 'eligibility.v2', 'structured-mandate.v2', 'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1')
$$, '23503', null, 'a slate cannot be filed under a tenant that does not own the investor');
select throws_ok($$
  insert into recommendation.slates
    (tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
     eligibility_policy_version, structured_generator_version, feature_schema_version, ranker_version, ranking_config_version)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
     'GATEQ', 'eligibility', 'structured-mandate.v2', 'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1')
$$, '23514', null, 'every version is a bounded versioned identifier');
select throws_ok($$
  update recommendation.slates set status = 'CURRENT' where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'a slate cannot become CURRENT without a fingerprint, publication and expiry');

-- Items ---------------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.slate_items
    (id, tenant_id, slate_id, company_id, company_tenant_id, rank, internal_score, reason_codes,
     feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    ('00000000-0000-4000-8000-0000000009d1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1',
     '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 1, 0.75, '{STAGE_MATCH}'::text[],
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64),
     '{"structured":{"generatorVersion":"structured-mandate.v2","reasonCodes":["STAGE_OVERLAP"]},"semantic":null}'::jsonb)
$$, 'an item names its rank, its internal score and the exact feature snapshot ranked');
select throws_ok($$
  insert into recommendation.slate_items
    (tenant_id, slate_id, company_id, company_tenant_id, rank, feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 2,
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64), '{}'::jsonb)
$$, '23505', null, 'a company appears at most once per slate');
select throws_ok($$
  insert into recommendation.slate_items
    (tenant_id, slate_id, company_id, company_tenant_id, rank, feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 0,
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64), '{}'::jsonb)
$$, '23514', null, 'ranks start at one');
select throws_ok($$
  insert into recommendation.slate_items
    (tenant_id, slate_id, company_id, company_tenant_id, rank, internal_score, feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 3, 1.5,
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64), '{}'::jsonb)
$$, '23514', null, 'an internal score stays in [0, 1]');
select throws_ok($$
  insert into recommendation.slate_items
    (tenant_id, slate_id, company_id, company_tenant_id, rank, feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('tenant_b'), 4,
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64), '{}'::jsonb)
$$, '23503', null, 'an item names the company under its own tenant');
select throws_ok($$
  update recommendation.slate_items set rank = 9 where id = '00000000-0000-4000-8000-0000000009d1'
$$, '23514', null, 'an item''s rank never moves');
select throws_ok($$
  update recommendation.slate_items set internal_score = 0.1 where id = '00000000-0000-4000-8000-0000000009d1'
$$, '23514', null, 'nor its score');
select throws_ok($$
  delete from recommendation.feature_snapshots where id = '00000000-0000-4000-8000-0000000009f1'
$$, '23503', null, 'the feature snapshot an item ranked from cannot be removed under it');

-- Publication -----------------------------------------------------------------------------
select lives_ok($$
  update recommendation.slates
     set status = 'CURRENT', generation_fingerprint = repeat('1', 64), item_count = 1,
         diagnostics = '{"ranked":1}'::jsonb, published_at = now(), expires_at = now() + interval '1 day'
   where id = '00000000-0000-4000-8000-0000000009e1'
$$, 'a BUILDING slate publishes to CURRENT with its content stamped');
select throws_ok($$
  insert into recommendation.slate_items
    (tenant_id, slate_id, company_id, company_tenant_id, rank, feature_snapshot_id, feature_snapshot_fingerprint, candidate_provenance)
  values
    (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), 5,
     '00000000-0000-4000-8000-0000000009f1', repeat('a', 64), '{}'::jsonb)
$$, '23514', null, 'a published slate never gains an item');
select throws_ok($$
  update recommendation.slates set generation_fingerprint = repeat('2', 64) where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'a published slate''s fingerprint is frozen');
select throws_ok($$
  update recommendation.slates set item_count = 7 where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'and its item count');
select throws_ok($$
  update recommendation.slates set ranker_version = 'deterministic-ranker.v2' where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'and its versions: a rebuild is a new slate');
select throws_ok($$
  update recommendation.slates set mandate_id = '00000000-0000-4000-8000-0000000009a1', investor_organisation_id = '00000000-0000-4000-8000-0000000009b1', tenant_id = pg_temp.rls_id('tenant_a') where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'and its identity');
select throws_ok($$
  update recommendation.slates set status = 'BUILDING' where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'CURRENT never returns to BUILDING');

-- A second build supersedes; one CURRENT per key -------------------------------------------
select lives_ok($$
  insert into recommendation.slates
    (id, tenant_id, investor_organisation_id, mandate_id, mandate_version, mode,
     eligibility_policy_version, structured_generator_version, feature_schema_version, ranker_version, ranking_config_version)
  values
    ('00000000-0000-4000-8000-0000000009e2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 1,
     'INVESTOR_DISCOVER', 'eligibility.v2', 'structured-mandate.v2', 'recommendation-features.v1', 'deterministic-ranker.v1', 'ranking-config.v1')
$$, 'a rebuild starts while the previous slate is still served');
select throws_ok($$
  update recommendation.slates
     set status = 'CURRENT', generation_fingerprint = repeat('3', 64), published_at = now(), expires_at = now() + interval '1 day'
   where id = '00000000-0000-4000-8000-0000000009e2'
$$, '23505', null, 'but two CURRENT slates for one key can never coexist');
select lives_ok($$
  update recommendation.slates set status = 'SUPERSEDED', superseded_at = now() where id = '00000000-0000-4000-8000-0000000009e1';
  update recommendation.slates
     set status = 'CURRENT', generation_fingerprint = repeat('3', 64), published_at = now(), expires_at = now() + interval '1 day',
         supersedes_slate_id = '00000000-0000-4000-8000-0000000009e1'
   where id = '00000000-0000-4000-8000-0000000009e2'
$$, 'supersede then publish: readers see the old slate or the new one');
select throws_ok($$
  update recommendation.slates set status = 'CURRENT', superseded_at = null where id = '00000000-0000-4000-8000-0000000009e1'
$$, '23514', null, 'a superseded slate never becomes CURRENT again');
select is((select count(*)::int from recommendation.slate_items where slate_id = '00000000-0000-4000-8000-0000000009e1'), 1,
  'the superseded slate keeps its items: history stays interpretable');
select lives_ok($$
  update recommendation.slates set status = 'INVALIDATED', invalidated_at = now(), invalidation_reason = 'VISIBILITY_CHANGED'
   where id = '00000000-0000-4000-8000-0000000009e2'
$$, 'a CURRENT slate is invalidated with a bounded reason');
select throws_ok($$
  update recommendation.slates set status = 'EXPIRED' where id = '00000000-0000-4000-8000-0000000009e2'
$$, '23514', null, 'and stays terminal');

-- Refresh requests --------------------------------------------------------------------------
select lives_ok($$
  insert into recommendation.refresh_requests (tenant_id, investor_organisation_id, mandate_id, mode, priority, reason)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 'INVESTOR_DISCOVER', 'HIGH', 'MANDATE_HARD_CHANGED')
$$, 'a refresh request records the key, a priority and a bounded reason');
select throws_ok($$
  insert into recommendation.refresh_requests (tenant_id, investor_organisation_id, mandate_id, mode, reason)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009a1', 'INVESTOR_DISCOVER', 'MANUAL')
$$, '23505', null, 'one request row per key: work coalesces');

-- Exposure ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from recommendation.slates $$, '42501', null, 'anonymous cannot read slates');

select pg_temp.act_as_user_b();
select throws_ok($$ select id from recommendation.slates where tenant_id = pg_temp.rls_id('tenant_b') $$,
  '42501', null, 'not even the investor''s own member reads slates through the database');
select throws_ok($$ select * from recommendation.slate_items $$, '42501', null, 'nor items with their internal scores');
select throws_ok($$ select * from recommendation.refresh_requests $$, '42501', null, 'nor the refresh claim row');

select * from finish();
rollback;
