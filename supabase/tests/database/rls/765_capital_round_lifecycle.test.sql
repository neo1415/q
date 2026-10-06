-- Capital round lifecycle and history (P8, 2026-10-06).
--
-- core.capital_rounds: the widened lifecycle (FIRST_CLOSED, CANCELLED),
-- terms in exact numeric, one lead (canonical relationship or a typed name,
-- never both, and only this company's relationship), an extension only of
-- the same company's round, closed or cancelled never current.
-- core.capital_round_events: append-only, server-written, read by members
-- of the company's organisation only: never another tenant (by real id),
-- never a revoked member of the owning organisation, never anonymous.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- DB BYPASS ≠ BUSINESS AUTHORISATION (the server also requires
-- capital_objective.* on the company).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(32);

-- Company A (tenant A), Company B (tenant B), Company R (tenant R, whose
-- only member has been revoked); investor B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000765c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Lifecycle Co A', 'lifecycle-co-a'),
  ('00000000-0000-4000-8000-0000000765c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Lifecycle Co B', 'lifecycle-co-b'),
  ('00000000-0000-4000-8000-0000000765c3', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Lifecycle Co R', 'lifecycle-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000765e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Lifecycle Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000076501', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765e2', 'CONNECTED'),
  ('00000000-0000-4000-8000-000000076502', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000765c2', '00000000-0000-4000-8000-0000000765e2', 'CONNECTED');
insert into core.capital_rounds (id, tenant_id, company_id, name, target_amount, currency_code, instrument, status, is_current, opened_on, first_closed_on, valuation_cap_amount, discount_percent, pro_rata_rights, lead_relationship_id, created_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000765a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', 'Seed', 1500000, 'USD', 'SAFE', 'FIRST_CLOSED', true, '2026-09-01', '2026-09-20', 12000000.00, 20.00, 'MAJOR_INVESTORS', '00000000-0000-4000-8000-000000076501', pg_temp.rls_id('user_a'), 'p8-round-a-seed-01');
insert into core.capital_rounds (id, tenant_id, company_id, name, target_amount, currency_code, instrument, status, is_current, opened_on, closed_on, closed_by_user_id, reported_raised_amount, created_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000765a2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', 'Pre-seed', 300000, 'USD', 'ASA', 'CLOSED', false, '2024-03-01', '2024-06-30', pg_temp.rls_id('user_a'), 320000.50, pg_temp.rls_id('user_a'), 'p8-round-a-pre-01'),
  ('00000000-0000-4000-8000-0000000765b1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000765c2', 'Series A', 5000000, 'EUR', 'EQUITY', 'CLOSED', false, '2026-01-01', '2026-04-01', pg_temp.rls_id('user_b'), null, pg_temp.rls_id('user_b'), 'p8-round-b-a-01'),
  ('00000000-0000-4000-8000-0000000765d1', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000765c3', 'Seed', 900000, 'GBP', 'SAFE', 'CLOSED', false, '2025-01-01', '2025-05-01', pg_temp.rls_id('user_r'), null, pg_temp.rls_id('user_r'), 'p8-round-r-seed-01');
insert into core.capital_round_events (tenant_id, company_id, round_id, revision, event_type, occurred_on, amount, currency_code, label, actor_user_id) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765a1', 1, 'CREATED', '2026-09-01', null, null, null, pg_temp.rls_id('user_a')),
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765a1', 2, 'CLOSE_RECORDED', '2026-09-20', 600000.25, 'USD', 'First close', pg_temp.rls_id('user_a')),
  (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000765c2', '00000000-0000-4000-8000-0000000765b1', 1, 'CREATED', '2026-01-01', null, null, null, pg_temp.rls_id('user_b')),
  (pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000765c3', '00000000-0000-4000-8000-0000000765d1', 1, 'CREATED', '2025-01-01', null, null, null, pg_temp.rls_id('user_r'));

-- Shape -------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'core.capital_round_events'::regclass),
  'row level security is on for round history');
select ok(not has_table_privilege('authenticated', 'core.capital_round_events', 'insert')
      and not has_table_privilege('authenticated', 'core.capital_round_events', 'update')
      and not has_table_privilege('authenticated', 'core.capital_round_events', 'delete'),
  'no client role writes round history');
select ok(not has_table_privilege('anon', 'core.capital_round_events', 'select'),
  'the anonymous role has no grant on round history');
select is((select (valuation_cap_amount::text, discount_percent::text, reported_raised_amount::text)::text
             from core.capital_rounds where id in ('00000000-0000-4000-8000-0000000765a1') ),
  '(12000000.00,20.00,)', 'terms are exact numeric; an unsaid reported amount stays NULL, not zero');
select is((select amount::text from core.capital_round_events where label = 'First close'), '600000.25',
  'a close amount is exact numeric');

-- Lifecycle invariants -------------------------------------------------------------------
select throws_ok(
  $$ update core.capital_rounds set status = 'LIVE' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'the status vocabulary is closed');
select throws_ok(
  $$ update core.capital_rounds set first_closed_on = null where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a first-closed round keeps its first close date');
select throws_ok(
  $$ update core.capital_rounds set status = 'CANCELLED' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a cancelled round records when it was cancelled');
select throws_ok(
  $$ update core.capital_rounds set status = 'CANCELLED', cancelled_on = '2026-10-01' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a cancelled round is never the current one');
select lives_ok(
  $$ update core.capital_rounds set status = 'CANCELLED', cancelled_on = '2026-10-01', cancelled_reason = 'Lead pulled out', is_current = false
      where id = '00000000-0000-4000-8000-0000000765a1' $$,
  'a round can be cancelled with a reason');
select lives_ok(
  $$ update core.capital_rounds set status = 'FIRST_CLOSED', cancelled_on = null, cancelled_reason = null, is_current = true
      where id = '00000000-0000-4000-8000-0000000765a1' $$,
  'a cancelled round can be reopened (its history keeps the cancel)');
select throws_ok(
  $$ update core.capital_rounds set instrument = 'SAFT' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'the instrument vocabulary is closed (ASA is in it)');
select throws_ok(
  $$ update core.capital_rounds set discount_percent = 100 where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a discount is under 100 percent');
select throws_ok(
  $$ update core.capital_rounds set hard_cap_amount = 1000000 where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a hard cap is at least the target');
select throws_ok(
  $$ update core.capital_rounds set valuation_amount = 9000000 where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'a valuation says whether it is pre- or post-money');
select throws_ok(
  $$ update core.capital_rounds set lead_investor_name = 'Someone Else' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'one lead: a relationship or a typed name, never both');
select throws_ok(
  $$ update core.capital_rounds set lead_relationship_id = '00000000-0000-4000-8000-000000076502' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23514', null, 'the lead is this company''s own relationship');
select throws_ok(
  $$ update core.capital_rounds set extends_round_id = '00000000-0000-4000-8000-0000000765b1' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  '23503', null, 'an extension extends only a round of the same company');
select lives_ok(
  $$ update core.capital_rounds set extends_round_id = '00000000-0000-4000-8000-0000000765a2' where id = '00000000-0000-4000-8000-0000000765a1' $$,
  'a round can extend an earlier round of the same company');

-- History is append-only -----------------------------------------------------------------
select throws_ok(
  $$ update core.capital_round_events set amount = 1 where label = 'First close' $$,
  '42501', null, 'round history cannot be rewritten, even by the server');
select throws_ok(
  $$ delete from core.capital_round_events where label = 'First close' $$,
  '42501', null, 'round history cannot be deleted');
select throws_ok(
  $$ insert into core.capital_round_events (tenant_id, company_id, round_id, revision, event_type, occurred_on, actor_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765a1', 2, 'TERMS_REVISED', '2026-10-01', pg_temp.rls_id('user_a')) $$,
  '23505', null, 'one history row per revision');
select throws_ok(
  $$ insert into core.capital_round_events (tenant_id, company_id, round_id, revision, event_type, occurred_on, amount, actor_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765a1', 9, 'TRANCHE_RECORDED', '2026-10-01', 5, pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a history amount carries its currency');
select throws_ok(
  $$ insert into core.capital_round_events (tenant_id, company_id, round_id, revision, event_type, occurred_on, actor_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c2', '00000000-0000-4000-8000-0000000765a1', 9, 'REOPENED', '2026-10-01', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'a history row belongs to its round''s company');

-- User A: their own company's history only -------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.capital_round_events where company_id = '00000000-0000-4000-8000-0000000765c1'), 2,
  'history: A reads Company A''s round history');
select is((select count(*)::int from core.capital_round_events where round_id = '00000000-0000-4000-8000-0000000765b1'), 0,
  'history: A cannot read Company B''s history (valid id, wrong tenant)');
select throws_ok(
  $$ insert into core.capital_round_events (tenant_id, company_id, round_id, revision, event_type, occurred_on, actor_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000765c1', '00000000-0000-4000-8000-0000000765a1', 7, 'REOPENED', '2026-10-01', pg_temp.rls_id('user_a')) $$,
  '42501', null, 'history: A cannot write history directly');

-- User B: the investor on A's lead relationship does not read A's history ------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.capital_round_events where company_id = '00000000-0000-4000-8000-0000000765c1'), 0,
  'history: B (A''s lead investor) does not read A''s round history');
select is((select count(*)::int from core.capital_rounds where id = '00000000-0000-4000-8000-0000000765a1'), 0,
  'rounds: B (A''s lead investor) does not read A''s round row');

-- Revoked member of the owning organisation, and anonymous ---------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.capital_round_events where company_id = '00000000-0000-4000-8000-0000000765c3'), 0,
  'history: a revoked member of Company R''s organisation reads none of it');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.capital_round_events $$, '42501', null,
  'history: anonymous has no access');

select pg_temp.act_as_privileged();
select is((select count(*)::int from core.capital_round_events where round_id in (
  '00000000-0000-4000-8000-0000000765a1', '00000000-0000-4000-8000-0000000765b1', '00000000-0000-4000-8000-0000000765d1')), 4,
  'the privileged server role reads every history row (expected; not authorisation)');

select * from finish();
rollback;
