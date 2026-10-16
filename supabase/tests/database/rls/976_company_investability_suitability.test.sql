-- 20261228171500 · Investability (InvestIQ, investor-facing) and Suitability.
-- Investability: the company's own members and any active participant while
-- the company is listed read it; a private company's is its members' only.
-- Suitability: only the investor organisation it belongs to. Revoked members,
-- other tenants and anon read nothing; no browser principal writes; the
-- investability history is append-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(20);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code,
                            short_description, marketplace_visibility)
values
  ('00000000-0000-4000-8000-0000000097c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Listed Co', 'listed-co-iq', 'seed', 'Listed.', 'network_visible'),
  ('00000000-0000-4000-8000-0000000097c2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Private Co', 'private-co-iq', 'seed', 'Private.', 'organisation_private');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000097b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Scoring Capital');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from,
                                    created_by_user_id)
values ('00000000-0000-4000-8000-0000000097d1', pg_temp.rls_id('tenant_b'),
        '00000000-0000-4000-8000-0000000097b1', 'Seed fintech', 'ACTIVE', now(), pg_temp.rls_id('user_b'));

-- Writes (server) ------------------------------------------------------------------
select lives_ok(
  $$ insert into core.company_investability_assessments
       (id, tenant_id, company_id, organisation_id, method_version, revision, basis_hash, status,
        score, band, confidence, areas_scored, areas_total, criteria_scored, criteria_applicable,
        summary, assessment)
     values ('00000000-0000-4000-8000-0000000097a1', pg_temp.rls_id('tenant_a'),
             '00000000-0000-4000-8000-0000000097c1', pg_temp.rls_id('org_a'),
             'investiq/v1+investability-inputs.v1', 1, repeat('a', 64), 'SCORED',
             54, 'DEVELOPING', 'LOW', 5, 8, 15, 46, '{"status":"SCORED"}', '{"assessment":{}}') $$,
  'the server records an investability revision');
select lives_ok(
  $$ insert into core.company_investability_assessments
       (id, tenant_id, company_id, organisation_id, method_version, revision, basis_hash, status,
        areas_scored, areas_total, criteria_scored, criteria_applicable, summary, assessment)
     values ('00000000-0000-4000-8000-0000000097a2', pg_temp.rls_id('tenant_a'),
             '00000000-0000-4000-8000-0000000097c2', pg_temp.rls_id('org_a'),
             'investiq/v1+investability-inputs.v1', 1, repeat('b', 64), 'INSUFFICIENT_EVIDENCE',
             1, 8, 2, 46, '{"status":"INSUFFICIENT_EVIDENCE"}', '{"assessment":{}}') $$,
  'insufficient evidence is recorded with no score');
select throws_ok(
  $$ insert into core.company_investability_assessments
       (tenant_id, company_id, organisation_id, method_version, revision, basis_hash, status,
        areas_scored, areas_total, criteria_scored, criteria_applicable, summary, assessment)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000097c1', pg_temp.rls_id('org_a'),
             'investiq/v1+investability-inputs.v1', 2, repeat('c', 64), 'SCORED',
             5, 8, 15, 46, '{}', '{}') $$,
  '23514', null, 'a SCORED row must carry its score: no default number');
select throws_ok(
  $$ insert into core.company_investability_assessments
       (tenant_id, company_id, organisation_id, method_version, revision, basis_hash, status,
        areas_scored, areas_total, criteria_scored, criteria_applicable, summary, assessment)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000097c1', pg_temp.rls_id('org_a'),
             'investiq/v1+investability-inputs.v1', 1, repeat('d', 64), 'INSUFFICIENT_EVIDENCE',
             1, 8, 2, 46, '{}', '{}') $$,
  '23505', null, 'one row per revision');
select throws_ok(
  $$ update core.company_investability_assessments set score = 99
      where id = '00000000-0000-4000-8000-0000000097a1' $$,
  '42501', null, 'an investability revision is never rewritten');
select throws_ok(
  $$ delete from core.company_investability_assessments
      where id = '00000000-0000-4000-8000-0000000097a1' $$,
  '42501', null, 'nor deleted');
select lives_ok(
  $$ insert into core.investor_company_suitability
       (tenant_id, investor_organisation_id, organisation_id, mandate_id, company_id,
        fit_config_version, status, score, known, applicable, summary, computed_at)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000097b1', pg_temp.rls_id('org_b'),
             '00000000-0000-4000-8000-0000000097d1', '00000000-0000-4000-8000-0000000097c1',
             'ranking-config.v4', 'SCORED', 80, 6, 7, '{"status":"SCORED"}', now()) $$,
  'the slate build records a suitability row');

-- Owner (company organisation A) -----------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.company_investability_assessments
            where company_id in ('00000000-0000-4000-8000-0000000097c1', '00000000-0000-4000-8000-0000000097c2')),
  2, 'the company''s own members read both of their companies');
select is((select count(*)::int from core.investor_company_suitability),
  0, 'a founder never reads an investor''s suitability rows');
select throws_ok(
  $$ insert into core.company_investability_assessments
       (tenant_id, company_id, organisation_id, method_version, revision, basis_hash, status,
        score, band, confidence, areas_scored, areas_total, criteria_scored, criteria_applicable, summary, assessment)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000097c1', pg_temp.rls_id('org_a'),
             'investiq/v1+investability-inputs.v1', 5, repeat('e', 64), 'SCORED',
             100, 'STRONG', 'HIGH', 8, 8, 46, 46, '{}', '{}') $$,
  '42501', null, 'a founder cannot write their own score');

-- Investor (another tenant, active participant) --------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.company_investability_assessments
            where company_id = '00000000-0000-4000-8000-0000000097c1'),
  1, 'an investor reads a listed company''s investability');
select is((select count(*)::int from core.company_investability_assessments
            where company_id = '00000000-0000-4000-8000-0000000097c2'),
  0, 'an investor never reads a private company''s investability');
select is((select count(*)::int from core.investor_company_suitability
            where investor_organisation_id = '00000000-0000-4000-8000-0000000097b1'),
  1, 'an investor reads their own suitability rows');
select throws_ok(
  $$ update core.investor_company_suitability set score = 100 $$,
  '42501', null, 'an investor cannot change their suitability rows');

-- Revoked member and anon -------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.company_investability_assessments),
  0, 'a revoked member reads no investability, listed or not');
select is((select count(*)::int from core.investor_company_suitability),
  0, 'nor any suitability');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.company_investability_assessments $$,
  '42501', null, 'anon reads no investability');
select throws_ok($$ select count(*) from core.investor_company_suitability $$,
  '42501', null, 'anon reads no suitability');

-- Unlisting removes network visibility at once -----------------------------------------
select pg_temp.reset_test_identity();
update core.companies set marketplace_visibility = 'organisation_private'
 where id = '00000000-0000-4000-8000-0000000097c1';
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.company_investability_assessments
            where company_id = '00000000-0000-4000-8000-0000000097c1'),
  0, 'once unlisted, an investor reads nothing of it');

select pg_temp.reset_test_identity();
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'core' and table_name = 'company_investability_assessments'
      and column_name in ('target_amount', 'raise_objective', 'valuation_amount', 'readiness',
                          'coaching', 'raw_mandate_text', 'team_size')),
  0, 'no founder-private field exists in the investability projection');

select * from finish();
rollback;
