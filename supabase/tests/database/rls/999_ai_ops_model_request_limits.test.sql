-- 20261231320000: a per-request token limit on the models whose provider
-- account caps a single request (Groq 8K TPM); every other model unbounded.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select has_column('ai_ops', 'models', 'max_request_tokens',
  'models carry an optional per-request token limit');

select is(
  (select array_agg(m.model_code || '=' || m.max_request_tokens order by m.model_code)
     from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
    where p.code = 'groq'),
  array['openai/gpt-oss-120b=8000', 'openai/gpt-oss-20b=8000', 'qwen/qwen3.8-27b=8000'],
  'the Groq text models are limited to 8,000 tokens per request (documented TPM)');

select is(
  (select count(*)::int from ai_ops.models m join ai_ops.providers p on p.id = m.provider_id
    where p.code <> 'groq' and m.max_request_tokens is not null),
  0,
  'no other model is limited');

select throws_ok(
  $$ update ai_ops.models set max_request_tokens = 0
      where model_code = 'openai/gpt-oss-20b' $$,
  '23514',
  null,
  'a limit must be positive');

select is(
  (select count(*)::int from ai_ops.routing_policies
    where status = 'ACTIVE' and task_class <> 'UI_TRANSLATION'),
  7,
  'no routing policy changed');

select * from finish();
rollback;
