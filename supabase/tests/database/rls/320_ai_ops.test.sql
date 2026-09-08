-- CQ-Q-005 · ai_ops: the Model Gateway's catalog, price snapshots, routing
-- policies and usage ledger. Closed vocabularies, versioned prices, an
-- append-only ledger with tenant ownership, seeded operational rows, and
-- the fact that no browser principal reaches any of it.
--
--   Q                 ≠ model provider
--   available model   ≠ eligible model
--   free              ≠ safe
--   model usage       ≠ conversation content
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠ BUSINESS
-- AUTHORISATION. Tenant cost visibility is a purpose-built projection
-- later, never a policy on these tables.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(33);

-- Seed is present and shaped as the packet verified it -------------------------------
select is((select count(*)::int from ai_ops.providers), 2, 'two V1 providers are seeded');
select results_eq(
  $$ select code from ai_ops.providers order by code $$,
  $$ values ('google'), ('groq') $$,
  'the providers are google and groq');
select is((select privacy_policy_class from ai_ops.providers where code = 'google'), 'UNREVIEWED',
  'google data-use terms are recorded as unreviewed');
-- CQ-C5-R2A: groq was reviewed on 2026-09-08. The class states what the
-- vendor offers; the flag states what was enabled for this organisation, and
-- the ceiling below rests on BOTH, so both are asserted.
select is((select privacy_policy_class from ai_ops.providers where code = 'groq'), 'NO_TRAINING_ZERO_RETENTION',
  'groq data-use terms are reviewed: no training, zero retention');
select ok((select supports_zero_retention from ai_ops.providers where code = 'groq'),
  'groq zero data retention is recorded as enabled for this organisation');
select results_eq(
  $$ select model_code from ai_ops.models order by model_code $$,
  $$ values ('gemini-3.5-flash-lite'), ('gemini-3.8-flash'), ('openai/gpt-oss-120b'), ('openai/gpt-oss-20b') $$,
  'the four verified model ids are seeded, exactly');
select is((select count(*)::int from ai_ops.models where sensitivity_ceiling in ('HIGHLY_CONFIDENTIAL', 'RESTRICTED')), 0,
  'no model is cleared above CONFIDENTIAL: the strongest material never leaves through a vendor');
select is(
  (select count(*)::int
     from ai_ops.models m
     join ai_ops.providers p on p.id = m.provider_id
    where m.sensitivity_ceiling = 'CONFIDENTIAL'
      and not (p.privacy_policy_class in ('NO_TRAINING_ZERO_RETENTION', 'ENTERPRISE_CONTRACT')
               and (p.privacy_policy_class = 'ENTERPRISE_CONTRACT' or p.supports_zero_retention))),
  0,
  'every model cleared for confidential data sits behind a provider whose review justifies it');
select is((select sensitivity_ceiling from ai_ops.models where model_code = 'gemini-3.8-flash'), 'PUBLIC',
  'unverified gemini is public-only');
select is((select sensitivity_ceiling from ai_ops.models where model_code = 'openai/gpt-oss-120b'), 'CONFIDENTIAL',
  'groq carries confidential work under its reviewed zero-retention terms');
select is((select count(*)::int from ai_ops.model_prices), 5, 'five price snapshots are seeded');
select is(
  (select effective_to from ai_ops.model_prices where id = 'a3000000-0000-4000-8000-000000000002'),
  '2027-01-01T00:00:00Z'::timestamptz,
  'the introductory gemini-3.8-flash price closes on 2027-01-01');
select is(
  (select input_per_million from ai_ops.model_prices where id = 'a3000000-0000-4000-8000-000000000003'),
  1.50::numeric(12,6),
  'the announced 2027 price is a separate row, not an edit');
select is((select count(*)::int from ai_ops.routing_policies where status = 'ACTIVE'), 7,
  'seven active v1 routing policies, one per text task class');
select is((select count(*)::int from ai_ops.routing_policies where task_class in ('EMBEDDING', 'REALTIME_VOICE', 'GUARDRAIL')), 0,
  'no policy routes embedding, voice or guardrail to a model');

-- Closed vocabularies -----------------------------------------------------------------
select throws_ok(
  $$ update ai_ops.providers set status = 'MAYBE' where code = 'groq' $$,
  '23514', null, 'provider status is a closed vocabulary');
select throws_ok(
  $$ update ai_ops.models set sensitivity_ceiling = 'SECRET' where model_code = 'openai/gpt-oss-20b' $$,
  '23514', null, 'sensitivity ceiling is the doc 15 vocabulary');
select throws_ok(
  $$ insert into ai_ops.model_prices (model_id, input_per_million, output_per_million, effective_from, source_url, verified_at)
     values ('a2000000-0000-4000-8000-000000000003', 0.1, 0.2, now(), 'http://insecure.example', now()) $$,
  '23514', null, 'a price source must be an https URL');
select throws_ok(
  $$ insert into ai_ops.routing_policies (code, task_class, sensitivity_class, quality_floor, preferred_models, version)
     values ('latest', 'NORMAL_DIALOGUE', 'RESTRICTED', 'BASIC', '{a2000000-0000-4000-8000-000000000004}', 2) $$,
  '23514', null, 'a routing policy code carries a durable version, never "latest"');
select throws_ok(
  $$ insert into ai_ops.routing_policies (code, task_class, sensitivity_class, quality_floor, preferred_models, version)
     values ('normal_dialogue.v9', 'NORMAL_DIALOGUE', 'RESTRICTED', 'BASIC', '{}', 9) $$,
  '23514', null, 'a routing policy names at least one preferred model');

-- Usage ledger: tenant-owned, consistent, append-only ---------------------------------
insert into ai_ops.model_usage (tenant_id, user_id, q_run_id, task_class, provider_id, model_id, routing_policy_id, attempt,
  input_tokens, cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis, success, error_code, correlation_id)
values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'NORMAL_DIALOGUE',
   'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 1,
   120, 0, 40, 350, 0.000042, 'PRICE_SNAPSHOT', true, null, 'cor_test'),
  (pg_temp.rls_id('tenant_b'), null, null, 'FAST_CLASSIFICATION',
   'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 1,
   0, 0, 0, 1200, null, 'UNPRICED', false, 'TIMEOUT', null);

select is((select count(*)::int from ai_ops.model_usage), 2, 'success and failure attempts are both recorded');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, error_code)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 1, 10, 'UNPRICED', true, 'TIMEOUT') $$,
  '23514', null, 'a successful attempt carries no error code');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 1, 10, 'UNPRICED', false) $$,
  '23514', null, 'a failed attempt carries its class');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success, error_code)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 1, 10, 'UNPRICED', false, 'Google 503 Service Unavailable') $$,
  '23514', null, 'the error code is a stable class, never a provider message');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success)
     values (pg_temp.rls_id('tenant_a'), 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 7, 10, 'UNPRICED', true) $$,
  '23514', null, 'attempts are bounded');
select throws_ok(
  $$ update ai_ops.model_usage set cost_usd = 0 $$,
  '23001', null, 'usage rows cannot be rewritten');
select throws_ok(
  $$ delete from ai_ops.model_usage $$,
  '23001', null, 'usage rows cannot be deleted');
select throws_ok(
  $$ insert into ai_ops.model_usage (tenant_id, task_class, provider_id, model_id, attempt, latency_ms, cost_basis, success)
     values ('00000000-0000-4000-8000-00000000dead', 'NORMAL_DIALOGUE', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 1, 10, 'UNPRICED', true) $$,
  '23503', null, 'a usage row belongs to a real tenant');

-- No browser principal reaches ai_ops --------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from ai_ops.model_prices $$, '42501', null, 'anonymous cannot read prices');
select throws_ok($$ select * from ai_ops.model_usage $$, '42501', null, 'anonymous cannot read the usage ledger');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from ai_ops.routing_policies $$, '42501', null, 'an authenticated browser session cannot read routing policy');
select throws_ok($$ select * from ai_ops.model_usage $$, '42501', null, 'an authenticated browser session cannot read usage, even its own tenant''s');
select throws_ok($$ update ai_ops.providers set status = 'DISABLED' $$, '42501', null, 'a browser session cannot flip a kill switch');

select * from finish();
rollback;
