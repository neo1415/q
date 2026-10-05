-- Capital rounds and the commitment's transfer and receipt (2026-10-04).
--
-- core.capital_rounds is read by members of the organisation that owns the
-- company: never by another tenant (by its real id), never anonymously,
-- never after membership is revoked; no client role writes. Database
-- invariants: exact positive money with an ISO currency, a closed
-- instrument and status vocabulary, at most one current round, a closed
-- round is never current, tenant coherence. network.commitments: the two
-- new statuses keep their who-and-when, the confirmation survives every
-- later status (a confirmed commitment may now be withdrawn), and a
-- commitment counts only toward its own company's round.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- DB BYPASS ≠ BUSINESS AUTHORISATION (the server also requires
-- capital_objective.* on the company, and the right side for each step).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(30);

-- Company A (tenant A) and Company B (tenant B); investor B (tenant B).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000076c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Round Co A', 'round-co-a'),
  ('00000000-0000-4000-8000-0000000076c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Round Co B', 'round-co-b');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000076e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Round Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000007601', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076c1', '00000000-0000-4000-8000-0000000076e2', 'CONNECTED');
insert into core.capital_rounds (id, tenant_id, company_id, name, target_amount, currency_code, instrument, status, is_current, opened_on, created_by_user_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000076a1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076c1', 'Seed', 1500000.50, 'USD', 'SAFE', 'OPEN', true, '2026-09-01', pg_temp.rls_id('user_a'), 'round-a-seed-0001'),
  ('00000000-0000-4000-8000-0000000076a2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076c1', 'Pre-seed', 300000, 'USD', 'SAFE', 'PLANNED', false, null, pg_temp.rls_id('user_a'), 'round-a-pre-0001'),
  ('00000000-0000-4000-8000-0000000076b1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000076c2', 'Series A', 5000000, 'EUR', 'EQUITY', 'OPEN', true, '2026-08-01', pg_temp.rls_id('user_b'), 'round-b-a-0001');

-- Shape ----------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'core.capital_rounds'::regclass),
  'row level security is on for capital rounds');
select ok(not has_table_privilege('authenticated', 'core.capital_rounds', 'insert')
      and not has_table_privilege('authenticated', 'core.capital_rounds', 'update')
      and not has_table_privilege('authenticated', 'core.capital_rounds', 'delete'),
  'no client role writes a round');
select ok(not has_table_privilege('anon', 'core.capital_rounds', 'select'),
  'the anonymous role has no grant on rounds');
select is((select target_amount::text from core.capital_rounds where id = '00000000-0000-4000-8000-0000000076a1'), '1500000.50',
  'a round''s target is exact numeric');

-- Round invariants -----------------------------------------------------------------
select throws_ok(
  $$ update core.capital_rounds set is_current = true where id = '00000000-0000-4000-8000-0000000076a2' $$,
  '23505', null, 'at most one current round per company');
select throws_ok(
  $$ update core.capital_rounds set target_amount = 0 where id = '00000000-0000-4000-8000-0000000076a1' $$,
  '23514', null, 'a target must be more than zero');
select throws_ok(
  $$ update core.capital_rounds set currency_code = '$' where id = '00000000-0000-4000-8000-0000000076a1' $$,
  '23514', null, 'a currency symbol is not a currency code');
select throws_ok(
  $$ update core.capital_rounds set instrument = 'priced' where id = '00000000-0000-4000-8000-0000000076a1' $$,
  '23514', null, 'the instrument vocabulary is closed');
select throws_ok(
  $$ update core.capital_rounds set status = 'CLOSED', closed_on = '2026-10-01', closed_by_user_id = pg_temp.rls_id('user_a')
      where id = '00000000-0000-4000-8000-0000000076a1' $$,
  '23514', null, 'a closed round is never the current one');
select throws_ok(
  $$ update core.capital_rounds set status = 'OPEN' where id = '00000000-0000-4000-8000-0000000076a2' $$,
  '23514', null, 'an open round has an opening date');
select throws_ok(
  $$ update core.capital_rounds set tenant_id = pg_temp.rls_id('tenant_b') where id = '00000000-0000-4000-8000-0000000076a1' $$,
  '23503', null, 'a round cannot drift to another tenant than its company');

-- Commitments: the round, the transfer and the receipt ------------------------------
insert into network.commitments (id, tenant_id, relationship_id, amount, currency_code, level, status, stated_by_side, stated_by_user_id, confirmed_by_user_id, confirmed_at, round_id, idempotency_key) values
  ('00000000-0000-4000-8000-0000000076d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000007601', 1000000, 'USD', 'FIRM', 'CONFIRMED', 'COMPANY',
   pg_temp.rls_id('user_a'), pg_temp.rls_id('user_b'), clock_timestamp(), '00000000-0000-4000-8000-0000000076a1', 'round-commit-0001');

select throws_ok(
  $$ update network.commitments set round_id = '00000000-0000-4000-8000-0000000076b1' where id = '00000000-0000-4000-8000-0000000076d1' $$,
  '23514', null, 'a commitment counts only toward its own company''s round');
select throws_ok(
  $$ update network.commitments set status = 'TRANSFER_SENT' where id = '00000000-0000-4000-8000-0000000076d1' $$,
  '23514', null, 'marked sent records who and when');
select throws_ok(
  $$ update network.commitments set status = 'RECEIVED' where id = '00000000-0000-4000-8000-0000000076d1' $$,
  '23514', null, 'received records who and when');
select lives_ok(
  $$ update network.commitments set status = 'TRANSFER_SENT', transfer_sent_by_user_id = pg_temp.rls_id('user_b'),
            transfer_sent_at = clock_timestamp(), transfer_reference = 'WIRE-REF-001'
      where id = '00000000-0000-4000-8000-0000000076d1' $$,
  'the investor''s side marks a confirmed commitment sent, with a reference');
select throws_ok(
  $$ update network.commitments set confirmed_at = null, confirmed_by_user_id = null where id = '00000000-0000-4000-8000-0000000076d1' $$,
  '23514', null, 'money in flight keeps its confirmation');
select lives_ok(
  $$ update network.commitments set status = 'RECEIVED', received_by_user_id = pg_temp.rls_id('user_a'), received_at = clock_timestamp()
      where id = '00000000-0000-4000-8000-0000000076d1' $$,
  'the company''s side confirms receipt');
select is((select (transfer_reference, confirmed_at is not null, transfer_sent_at is not null)::text
             from network.commitments where id = '00000000-0000-4000-8000-0000000076d1'),
  '(WIRE-REF-001,t,t)', 'receipt keeps the confirmation and the transfer on the same row');
select is((select coalesce(sum(amount), 0)::text from network.commitments
            where round_id = '00000000-0000-4000-8000-0000000076a1' and status = 'RECEIVED'),
  '1000000', 'a round''s raised amount is the exact sum of its received commitments');

-- A confirmed commitment may be withdrawn (the old check forbade it).
insert into network.commitments (id, tenant_id, relationship_id, amount, currency_code, level, status, stated_by_side, stated_by_user_id, confirmed_by_user_id, confirmed_at, idempotency_key) values
  ('00000000-0000-4000-8000-0000000076d2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000007601', 250000, 'USD', 'SOFT', 'CONFIRMED', 'INVESTOR',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_a'), clock_timestamp(), 'round-commit-0002');
select lives_ok(
  $$ update network.commitments set status = 'WITHDRAWN', withdrawn_by_user_id = pg_temp.rls_id('user_b'), withdrawn_at = clock_timestamp()
      where id = '00000000-0000-4000-8000-0000000076d2' $$,
  'a confirmed commitment can be withdrawn; its confirmation stays as history');

-- Notices ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'COMMITMENT', 'Round Capital B marked USD 1,000,000 sent', 'commitment:test-0001') $$,
  'the other side can be told of each commitment step');

-- User A: their own company's rounds only ---------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.capital_rounds where company_id = '00000000-0000-4000-8000-0000000076c1'), 2,
  'rounds: A sees Company A''s rounds');
select is((select count(*)::int from core.capital_rounds where id = '00000000-0000-4000-8000-0000000076b1'), 0,
  'rounds: A cannot see Company B''s round (valid id, wrong tenant)');
select throws_ok(
  $$ insert into core.capital_rounds (tenant_id, company_id, name, target_amount, currency_code, instrument, status, opened_on, created_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000076c1', 'Bridge', 100000, 'USD', 'SAFE', 'OPEN', '2026-10-01', pg_temp.rls_id('user_a'), 'round-a-bridge-01') $$,
  '42501', null, 'rounds: A cannot write a round directly');
select throws_ok(
  $$ update core.capital_rounds set target_amount = 1 where id = '00000000-0000-4000-8000-0000000076b1' $$,
  '42501', null, 'rounds: A cannot change Company B''s round');

-- User B: their own company's round, and the commitment as the investor's side ---------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.capital_rounds), 1,
  'rounds: B sees only Company B''s round');
select is((select count(*)::int from core.capital_rounds where id = '00000000-0000-4000-8000-0000000076a1'), 0,
  'rounds: B (the investor on A''s commitment) does not read A''s round itself');

-- Revoked and anonymous ------------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.capital_rounds), 0, 'rounds: a revoked member reads none');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.capital_rounds $$, '42501', null,
  'rounds: anonymous has no access');

select pg_temp.act_as_privileged();
select is((select count(*)::int from core.capital_rounds where id in (
  '00000000-0000-4000-8000-0000000076a1', '00000000-0000-4000-8000-0000000076b1')), 2,
  'the privileged server role reads every round (expected; not authorisation)');

select * from finish();
rollback;
