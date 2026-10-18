-- Deal close (2026-10-08) · network.deal_terms, network.deal_closes,
-- network.deal_close_checklist, network.relationship_reports.
--
-- Terms and closes are read by both parties; reports by both parties when
-- relationship_shared and only by the owning side when private; a
-- checklist only by its own side. Never another tenant's, never after
-- membership is revoked, never anonymously. No client writes. Terms are
-- revisioned (never edited); closes, ticks and reports are append-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server also decides the party and stage).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(26);

-- Company A (tenant A) ↔ investor B (tenant B); company R (tenant R) ↔ investor B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000089c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Deal Co A', 'deal-co-a'),
  ('00000000-0000-4000-8000-0000000089c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Deal Co R', 'deal-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000089e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Deal Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000008901', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000089c1', '00000000-0000-4000-8000-0000000089e2', 'INVESTED'),
  ('00000000-0000-4000-8000-000000008902', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000089c2', '00000000-0000-4000-8000-0000000089e2', 'INVESTED');

insert into network.commitments (id, tenant_id, relationship_id, amount, currency_code, level, status,
    stated_by_side, stated_by_user_id, confirmed_by_user_id, confirmed_at, received_by_user_id, received_at, idempotency_key) values
  ('00000000-0000-4000-8000-0000000089d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 250000, 'USD', 'SOFT', 'RECEIVED',
   'INVESTOR', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_a'), now(), pg_temp.rls_id('user_a'), now(), 'deal-commit-0001');

insert into network.deal_terms (id, tenant_id, relationship_id, version, instrument, amount, currency_code,
    valuation_cap, valuation_basis, recorded_by_side, recorded_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000089f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 1, 'SAFE', 250000, 'USD',
   8000000, 'POST_MONEY', 'INVESTOR', pg_temp.rls_id('user_b'), 'deal-terms-0001'),
  ('00000000-0000-4000-8000-0000000089f9', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000008902', 1, 'SAFE', 100000, 'USD',
   null, null, 'INVESTOR', pg_temp.rls_id('user_b'), 'deal-terms-0009');

insert into network.relationship_reports (id, tenant_id, relationship_id, kind, owner_side, visibility_scope, version,
    title, content, content_sha256, through_sequence, compiler_version, generated_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000089a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 'DILIGENCE', 'INVESTOR',
   'relationship_shared', 1, 'Diligence report: Deal Co A', '{}', repeat('a', 64), 3, 'deal-report.v1', pg_temp.rls_id('user_b'), 'deal-report-0001'),
  ('00000000-0000-4000-8000-0000000089a2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000008901', 'INVESTMENT_MEMO', 'INVESTOR',
   'investor_private', 1, 'Investment memo: Deal Co A', '{"secret": "our band"}', repeat('b', 64), 3, 'deal-report.v1', pg_temp.rls_id('user_b'), 'deal-report-0002'),
  ('00000000-0000-4000-8000-0000000089a3', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 'DILIGENCE', 'COMPANY',
   'founder_private', 1, 'Diligence report: Deal Co A', '{}', repeat('c', 64), 3, 'deal-report.v1', pg_temp.rls_id('user_a'), 'deal-report-0003'),
  ('00000000-0000-4000-8000-0000000089a9', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000008902', 'DILIGENCE', 'INVESTOR',
   'relationship_shared', 1, 'Diligence report: Deal Co R', '{}', repeat('d', 64), 3, 'deal-report.v1', pg_temp.rls_id('user_b'), 'deal-report-0009');

-- Shape -------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'network.deal_terms'::regclass, 'network.deal_closes'::regclass,
  'network.deal_close_checklist'::regclass, 'network.relationship_reports'::regclass)),
  true, 'row level security is on for all four tables');
select ok(not has_table_privilege('authenticated', 'network.deal_terms', 'insert')
          and not has_table_privilege('authenticated', 'network.relationship_reports', 'insert')
          and not has_table_privilege('authenticated', 'network.deal_closes', 'insert'),
  'no client role may write terms, closes or reports');
select ok(not has_table_privilege('anon', 'network.relationship_reports', 'select'),
  'the anonymous role has no grant on reports');
select is((select data_type from information_schema.columns
            where table_schema = 'network' and table_name = 'deal_terms' and column_name = 'amount'),
  'numeric', 'money is numeric, never float');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into network.deal_terms (tenant_id, relationship_id, version, instrument, amount, currency_code, recorded_by_side, recorded_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 2, 'SAFE', 1, 'USD', 'INVESTOR', pg_temp.rls_id('user_b'), 'deal-terms-0002') $$,
  '23505', null, 'one current terms version per relationship');
select throws_ok(
  $$ update network.deal_terms set amount = 1 where id = '00000000-0000-4000-8000-0000000089f1' $$,
  '55000', null, 'recorded terms are never edited');
select throws_ok(
  $$ update network.deal_terms set status = 'SIGNED', signed_at = now(), signed_by_user_id = pg_temp.rls_id('user_a') where id = '00000000-0000-4000-8000-0000000089f1' $$,
  '23514', null, 'a signature needs the signed document');
select lives_ok(
  $$ update network.deal_terms set status = 'SIGNED', signed_at = now(), signed_by_user_id = pg_temp.rls_id('user_a'),
       signed_document_id = '00000000-0000-4000-8000-0000000089b1' where id = '00000000-0000-4000-8000-0000000089f1' $$,
  'RECORDED moves to SIGNED with its document');
select throws_ok(
  $$ update network.deal_terms set status = 'SUPERSEDED' where id = '00000000-0000-4000-8000-0000000089f1' $$,
  '55000', null, 'signed terms are final');
select throws_ok(
  $$ delete from network.deal_terms where id = '00000000-0000-4000-8000-0000000089f1' $$,
  '55000', null, 'terms are never deleted');
select throws_ok(
  $$ insert into network.relationship_reports (tenant_id, relationship_id, kind, owner_side, visibility_scope, version, title, content, content_sha256, through_sequence, compiler_version, generated_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 'INVESTMENT_MEMO', 'INVESTOR', 'relationship_shared', 2, 'x', '{}', repeat('e', 64), 1, 'deal-report.v1', pg_temp.rls_id('user_b'), 'deal-report-0004') $$,
  '23514', null, 'the memo is always investor-private');
select throws_ok(
  $$ insert into network.relationship_reports (tenant_id, relationship_id, kind, owner_side, visibility_scope, version, title, content, content_sha256, through_sequence, compiler_version, generated_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', 'DILIGENCE', 'COMPANY', 'investor_private', 2, 'x', '{}', repeat('e', 64), 1, 'deal-report.v1', pg_temp.rls_id('user_a'), 'deal-report-0005') $$,
  '23514', null, 'a private report belongs to its own side');
select throws_ok(
  $$ update network.relationship_reports set title = 'changed' where id = '00000000-0000-4000-8000-0000000089a1' $$,
  '55000', null, 'reports are append-only: a new version, never an edit');
select lives_ok(
  $$ insert into network.deal_closes (tenant_id, relationship_id, terms_id, commitment_id, closed_by_side, closed_by_user_id, closed_on, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', '00000000-0000-4000-8000-0000000089f1',
             '00000000-0000-4000-8000-0000000089d1', 'COMPANY', pg_temp.rls_id('user_a'), current_date, 'deal-close-0001') $$,
  'the server closes a deal');
select throws_ok(
  $$ insert into network.deal_closes (tenant_id, relationship_id, terms_id, commitment_id, closed_by_side, closed_by_user_id, closed_on, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008901', '00000000-0000-4000-8000-0000000089f1',
             '00000000-0000-4000-8000-0000000089d1', 'INVESTOR', pg_temp.rls_id('user_b'), current_date, 'deal-close-0002') $$,
  '23505', null, 'one close per relationship');
insert into network.deal_close_checklist (relationship_id, tenant_id, side, item_code, done_by_user_id) values
  ('00000000-0000-4000-8000-000000008901', pg_temp.rls_id('tenant_a'), 'COMPANY', 'CAP_TABLE_UPDATED', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-000000008901', pg_temp.rls_id('tenant_a'), 'INVESTOR', 'PORTFOLIO_ENTRY_CONFIRMED', pg_temp.rls_id('user_b'));

-- No raw client access ------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.relationship_reports $$, '42501', null,
  'no raw client access: reports are read through the server');
select pg_temp.act_as_privileged();
grant usage on schema network to authenticated;

-- The investor side --------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from network.relationship_reports
            where relationship_id = '00000000-0000-4000-8000-000000008901'), 2,
  'user B reads the shared report and its own memo, never the founder''s private report');
select is((select count(*)::int from network.deal_terms), 2, 'user B reads the terms on both of its relationships');
select is((select item_code from network.deal_close_checklist), 'PORTFOLIO_ENTRY_CONFIRMED',
  'user B reads only its own side''s checklist');

-- The company side ----------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from network.relationship_reports), 2,
  'user A reads the shared report and its own private one');
select is((select count(*)::int from network.relationship_reports where kind = 'INVESTMENT_MEMO'), 0,
  'the investor''s memo never reaches the founder');
select is((select count(*)::int from network.deal_terms), 1,
  'cross-tenant: user A reads only its own relationship''s terms');
select is((select count(*)::int from network.deal_closes), 1, 'user A reads its close');
select is((select item_code from network.deal_close_checklist), 'CAP_TABLE_UPDATED',
  'user A reads only its own side''s checklist');

-- Revoked and anonymous -----------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from network.relationship_reports), 0,
  'a revoked member reads no report, shared or not');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from network.deal_terms $$, '42501', null,
  'the anonymous role cannot read terms');

select * from finish();
rollback;
