-- 20261231597000 · DECISIONS 103: model-hosted web search calls are recorded
-- under PUBLIC_WEB_SEARCH. The closed purpose set gains one value; every
-- existing purpose stays allowed and anything outside the set is refused.
--
-- EXPECTED DB BEHAVIOUR: the server role writes ledger rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (q-api decides when a hosted search may run).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(4);

select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, input_tokens,
       cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis, success, purpose, correlation_id)
     values (pg_temp.rls_id('tenant_a'), 'EVIDENCE_SYNTHESIS',
             'a1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000009', 1,
             9000, 0, 400, 4200, 0.031, 'PRICE_SNAPSHOT', true, 'PUBLIC_WEB_SEARCH', 'cor_pws_test') $$,
  'a model-hosted web search is recorded under PUBLIC_WEB_SEARCH');
select lives_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'FAST_CLASSIFICATION', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000009', 1, 10, 'UNPRICED', true, 'WARMUP') $$,
  'the purposes that existed stay allowed');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, purpose)
     values (pg_temp.rls_id('tenant_a'), 'EVIDENCE_SYNTHESIS', 'a1000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-000000000009', 1, 0, 'UNPRICED', true, 'WEB_SEARCH') $$,
  '23514', null, 'a purpose outside the closed set is still refused');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'ai_ops' and table_name = 'model_usage'),
  0, 'no client role holds any privilege on the usage ledger');

select * from finish();
rollback;
