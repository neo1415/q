-- 20261203090000 · DUPLEX: full-duplex voice usage in the Model Gateway
-- ledger. VOICE_REALTIME joins the closed purpose set, the realtime model
-- is in the catalog (CONFIDENTIAL since 20261203100000, the reviewed
-- provider's standing), and the daily cap's
-- sum has its own index. Nothing about who may read the ledger changes.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes ledger rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the broker decides whether a line may open).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select is((select model_type from ai_ops.models where model_code = 'gpt-realtime-mini'), 'REALTIME',
  'the realtime model is catalogued as REALTIME');
select is((select sensitivity_ceiling from ai_ops.models where model_code = 'gpt-realtime-mini'), 'CONFIDENTIAL',
  'the realtime model carries the reviewed provider''s ceiling (founder approval, 20261203100000)');
select is((select output_per_million::text from ai_ops.model_prices where model_id = 'a2000000-0000-4000-8000-000000000022'), '2.400000',
  'the realtime model has a text price snapshot');

select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, user_id, task_class, provider_id, model_id, attempt, input_tokens,
       cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis, success, purpose, correlation_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REALTIME_VOICE',
             'a1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000022', 1,
             1200, 800, 300, 0, 0.00731, 'ESTIMATED', true, 'VOICE_REALTIME', 'rt_resp_1') $$,
  'a realtime response is recorded under VOICE_REALTIME');
select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000009', 1, 10, 'UNPRICED', true, 'DOCUMENT') $$,
  'the purposes that existed stay allowed');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'REALTIME_VOICE', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000022', 1, 0, 'ESTIMATED', true, 'VOICE_DUPLEX') $$,
  '23514', null, 'a purpose outside the closed set is still refused');
select is(
  (select sum(cost_usd)::text from ai_ops.model_usage
    where purpose = 'VOICE_REALTIME' and occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
  '0.00731000', 'today''s realtime spend sums the recorded rows');
select has_index('ai_ops', 'model_usage', 'model_usage_voice_realtime_occurred_idx',
  'the daily cap''s read has its index');

-- The ledger stays out of every browser principal's reach.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'ai_ops' and table_name = 'model_usage'),
  0, 'no client role holds any privilege on the usage ledger');

select * from finish();
rollback;
