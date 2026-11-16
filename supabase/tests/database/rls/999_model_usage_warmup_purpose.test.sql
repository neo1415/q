-- 20261231595500 · DECISIONS 101: the reader warm-up's calls are recorded
-- under WARMUP. The closed purpose set gains one value; every existing
-- purpose stays allowed and anything outside the set is still refused.
--
-- EXPECTED DB BEHAVIOUR: the server role writes ledger rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (q-api decides when a warm-up may run).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(4);

select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, input_tokens,
       cached_input_tokens, output_tokens, latency_ms, cost_basis, success, purpose, correlation_id)
     values (pg_temp.rls_id('tenant_a'), 'FAST_CLASSIFICATION',
             'a1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000009', 1,
             60, 0, 8, 900, 'UNPRICED', true, 'WARMUP', 'cor_warmup_test') $$,
  'a warm-up call is recorded under WARMUP, with no user and no run');
select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000009', 1, 10, 'UNPRICED', true, 'VOICE_REALTIME') $$,
  'the purposes that existed stay allowed');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'FAST_CLASSIFICATION', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000009', 1, 0, 'UNPRICED', true, 'WARM_UP') $$,
  '23514', null, 'a purpose outside the closed set is still refused');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'ai_ops' and table_name = 'model_usage'),
  0, 'no client role holds any privilege on the usage ledger');

select * from finish();
rollback;
