-- Owner 23 Oct 2026 · recommendation.fx_reference_rates: the ECB's daily
-- euro reference rates as dated, versioned reference data. Constrained,
-- append-only, idempotent per (source, version, date, currency), and
-- server-only: no browser principal reads or writes it.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into recommendation.fx_reference_rates
       (id, source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('00000000-0000-4000-8000-000000000fa1', 'ECB_EUROFXREF', 'eurofxref-daily.v1',
             '2026-10-23', 'EUR', 'GBP', 0.8612) $$,
  'a dated reference rate is recorded');

-- Idempotency --------------------------------------------------------------------------
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('ECB_EUROFXREF', 'eurofxref-daily.v1', '2026-10-23', 'EUR', 'GBP', 0.8612) $$,
  '23505', null, 'one rate per source, version, date and currency');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('ECB_EUROFXREF', 'eurofxref-daily.v1', '2026-10-23', 'EUR', 'USD', 0) $$,
  '23514', null, 'a rate is positive');
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('ECB_EUROFXREF', 'eurofxref-daily.v1', '2026-10-23', 'USD', 'GBP', 1.2) $$,
  '23514', null, 'the base is the euro');
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('ECB_EUROFXREF', 'eurofxref-daily.v1', '2026-10-23', 'EUR', 'usd', 1.1) $$,
  '23514', null, 'a currency is an ISO code');
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('A_GUESS', 'v1', '2026-10-23', 'EUR', 'USD', 1.1) $$,
  '23514', null, 'only a named publisher');

-- Append-only --------------------------------------------------------------------------
select throws_ok(
  $$ update recommendation.fx_reference_rates set rate = 0.9 where id = '00000000-0000-4000-8000-000000000fa1' $$,
  '23001', null, 'a published rate cannot be rewritten');
select throws_ok(
  $$ delete from recommendation.fx_reference_rates where id = '00000000-0000-4000-8000-000000000fa1' $$,
  '23001', null, 'a published rate cannot be deleted');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from recommendation.fx_reference_rates $$, '42501', null,
  'a browser user cannot read reference rates directly');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into recommendation.fx_reference_rates
       (source, source_version, rate_date, base_currency, quote_currency, rate)
     values ('ECB_EUROFXREF', 'eurofxref-daily.v1', '2026-10-24', 'EUR', 'GBP', 0.86) $$,
  '42501', null, 'anonymous cannot write a rate');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
