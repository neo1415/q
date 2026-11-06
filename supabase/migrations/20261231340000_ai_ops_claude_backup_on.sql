-- Switch the Claude backup on (owner, 2026-11-06; DECISIONS 62 and 67):
-- the agreed order for Q's reasoning is OpenAI -> Claude (paid) -> Groq
-- (free tier) last, with Gemini (PUBLIC-only) after them for PUBLIC work.
--
-- The seven version-2 Q text policies staged RETIRED by 20261231280000 and
-- ordered by 20261231300000 (gpt-5.6-luna -> claude-sonnet-5-5 for answers
-- and analysis, claude-haiku-5-5 for the turn reader, classification,
-- extraction and taxonomy -> Groq gpt-oss-120b -> Gemini) become ACTIVE.
-- The gateway takes the highest ACTIVE version for a task class at the same
-- sensitivity class (eligibility.ts selectRoutingPolicy), so v2 serves and
-- the v1 rows stay ACTIVE beside them as the instant rollback.
--
-- Safe with the two gateway changes that must deploy first (receipt
-- 2026-11-06-q-fallback-policy): a timed-out luna is retried before Claude
-- is asked, and Groq is never sent a request above its 8K per-request limit
-- (20261231320000), so a turn reading or a full answer never reaches it.
--
-- Data only: no DROP, no new table, no RLS or grant change; nothing else.
--
-- Rollback (one statement; v1 serves again at once):
--   update ai_ops.routing_policies set status = 'RETIRED'
--    where version = 2
--      and code in ('normal_dialogue.v2', 'evidence_synthesis.v2',
--        'comparison.v2', 'deep_investigation.v2', 'fast_classification.v2',
--        'structured_extraction.v2', 'taxonomy_mapping.v2');

do $$
begin
  if (select count(*) from ai_ops.models
       where model_code in ('openai/gpt-oss-120b', 'openai/gpt-oss-20b')
         and max_request_tokens is not null) <> 2 then
    raise exception 'apply 20261231320000 (provider request limits) before switching the Claude backup on';
  end if;
end;
$$;

update ai_ops.routing_policies
   set status = 'ACTIVE'
 where version = 2
   and code in ('normal_dialogue.v2', 'evidence_synthesis.v2',
                'comparison.v2', 'deep_investigation.v2',
                'fast_classification.v2', 'structured_extraction.v2',
                'taxonomy_mapping.v2');

do $$
begin
  if (select count(*) from ai_ops.routing_policies
       where version = 2 and status = 'ACTIVE') <> 7 then
    raise exception 'expected the seven v2 Q text policies ACTIVE';
  end if;
end;
$$;
