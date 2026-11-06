-- Provider fit (live 2026-11-06 13:00): Groq refused a 17k-token turn
-- reading with 413 "rate_limit_exceeded" because the account's tokens-per-
-- minute limit caps any single request. A model the account cannot send a
-- request of this size to must never be planned for it, as primary,
-- fallback or hedge.
--
-- Adds ai_ops.models.max_request_tokens: the most tokens one request may
-- carry (input plus the requested output budget); null means the context
-- window is the only bound. The gateway skips a model whose limit the
-- request's estimate exceeds (CONTEXT_WINDOW_TOO_SMALL), before any call.
--
-- Values: Groq's documented limits (console.groq.com/docs/rate-limits, read
-- 2026-11-06): openai/gpt-oss-120b and openai/gpt-oss-20b 8K TPM (30 RPM,
-- 1K RPD, 200K TPD); qwen/qwen3.8-27b 8K TPM as recorded on 2026-09-15
-- (20260918090000). If the account moves to a higher tier, raise these.
-- Whether the provider counts max_tokens toward a request is undocumented,
-- so the gateway counts the output budget too (the conservative reading).
--
-- Additive only: a nullable column with a check, three data updates. No
-- policy, routing, RLS or grant change; ai_ops.models stays
-- INTERNAL_SERVER_ONLY.
--
-- Rollback (one statement, no DROP): the limits off, the column kept:
--   update ai_ops.models set max_request_tokens = null
--    where max_request_tokens is not null;

alter table ai_ops.models
  add column max_request_tokens integer
    check (max_request_tokens is null or max_request_tokens > 0);

comment on column ai_ops.models.max_request_tokens is
  'Most tokens one request may carry (input + output budget) where the provider account caps a single request below the context window (e.g. Groq TPM). Null: context window only.';

update ai_ops.models m
   set max_request_tokens = 8000
  from ai_ops.providers p
 where p.id = m.provider_id
   and p.code = 'groq'
   and m.model_code in ('openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b');

do $$
begin
  if (select count(*) from ai_ops.models where max_request_tokens = 8000) <> 3 then
    raise exception 'expected the three Groq text models to carry their request limit';
  end if;
end;
$$;
