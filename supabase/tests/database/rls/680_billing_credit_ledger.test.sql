-- 20261127090000 · billing.credit_entries: append-only credit ledger
-- groundwork. Numeric money plus ISO currency, no rate set until the
-- founder sets one, idempotent per source event, server-only.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

select has_table('billing', 'credit_entries', 'the credit ledger exists');
select ok((select relrowsecurity from pg_class where oid = 'billing.credit_entries'::regclass),
  'RLS is on');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema = 'billing'
      and table_name = 'credit_entries'),
  0, 'no client role holds any privilege on it');

insert into billing.credit_entries (user_id, kind, unit, quantity, source, source_ref, occurred_at)
values (pg_temp.rls_id('user_a'), 'USAGE', 'MODEL_COST_USD', -0.01234567, 'MODEL_USAGE', 'model_usage:1', now());

select is((select rate_status from billing.credit_entries where source_ref = 'model_usage:1'),
  'RATE_NOT_SET', 'an entry is unrated by default');
select is((select currency::text from billing.credit_entries where source_ref = 'model_usage:1'),
  'USD', 'money carries an ISO currency');
select is((select account_key from billing.credit_entries where source_ref = 'model_usage:1'),
  'p:' || pg_temp.rls_id('user_a')::text, 'a person alone is their own account');
select is((select quantity::text from billing.credit_entries where source_ref = 'model_usage:1'),
  '-0.01234567', 'quantities are exact numerics, never floats');

select throws_ok(
  $$insert into billing.credit_entries (user_id, kind, unit, quantity, source, source_ref, occurred_at)
    values (pg_temp.rls_id('user_a'), 'USAGE', 'MODEL_COST_USD', -1, 'MODEL_USAGE', 'model_usage:1', now())$$,
  '23505', null, 'one entry per source event');
select throws_ok(
  $$insert into billing.credit_entries (user_id, kind, unit, quantity, amount, source, source_ref, occurred_at)
    values (pg_temp.rls_id('user_a'), 'USAGE', 'MODEL_COST_USD', -1, 0.5, 'MODEL_USAGE', 'model_usage:2', now())$$,
  '23514', null, 'no money without a rate (RATE_NOT_SET)');
select throws_ok(
  $$insert into billing.credit_entries (user_id, kind, unit, quantity, currency, source, source_ref, occurred_at)
    values (pg_temp.rls_id('user_a'), 'USAGE', 'MODEL_COST_USD', -1, 'usd', 'MODEL_USAGE', 'model_usage:3', now())$$,
  '23514', null, 'a currency is an upper-case ISO code');
select throws_ok(
  $$update billing.credit_entries set quantity = -1 where source_ref = 'model_usage:1'$$,
  '23001', null, 'entries are never rewritten');

select pg_temp.act_as_user_a();
select throws_ok($$select count(*) from billing.credit_entries$$, '42501', null,
  'a member does not read the ledger directly (the API decides)');
select pg_temp.act_as_anonymous();
select throws_ok($$select count(*) from billing.credit_entries$$, '42501', null,
  'the anonymous role reads nothing');

select * from finish();
rollback;
