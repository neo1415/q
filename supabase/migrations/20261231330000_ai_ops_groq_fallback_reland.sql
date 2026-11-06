-- Re-land of the Groq CONFIDENTIAL fallback on the v1 Q text policies
-- (first landed as 20261231290000, rolled back by 20261231310000 after a
-- production regression at 13:00 on 2026-11-06).
--
-- Why it failed then, and what is different now:
--   1. A single gpt-5.6-luna timeout handed the turn to the next model at
--      once. The gateway now retries a timed-out (or otherwise passing)
--      failure on the same model first; another model is asked only after
--      those retries, or at once for a spent account or refused key.
--   2. Groq refused the 17k-token turn reading (413): its account caps any
--      single request at 8K tokens per minute. 20261231320000 records that
--      limit (ai_ops.models.max_request_tokens), and the gateway never plans
--      a model for a request above it, as primary, fallback or hedge.
--   So Groq now serves only what it can take: small CONFIDENTIAL requests
--   (classification, short extraction) when OpenAI's account is spent or
--   failing after retries. Turn readings and full answers stay with OpenAI
--   (and Claude once the v2 switch is on); they are never sent to Groq.
--
-- Requires 20261231320000 applied first (the guard below checks it).
--
-- Same change as 20261231290000: on the seven ACTIVE version-1 Q text
-- policies, openai/gpt-oss-120b (a2...0004) directly after gpt-5.6-luna,
-- and openai/gpt-oss-20b (a2...0003) too on fast_classification and
-- taxonomy_mapping. Gemini keeps its place. No DROP, no RLS or grant change.
--
-- Rollback (one statement):
--   update ai_ops.routing_policies
--      set fallback_models = array_remove(array_remove(fallback_models,
--            'a2000000-0000-4000-8000-000000000004'::uuid),
--            'a2000000-0000-4000-8000-000000000003'::uuid)
--    where status = 'ACTIVE' and version = 1
--      and code in ('normal_dialogue.v1', 'evidence_synthesis.v1',
--        'comparison.v1', 'deep_investigation.v1', 'fast_classification.v1',
--        'structured_extraction.v1', 'taxonomy_mapping.v1');

do $$
begin
  if (select count(*) from ai_ops.models
       where model_code in ('openai/gpt-oss-120b', 'openai/gpt-oss-20b')
         and max_request_tokens is not null) <> 2 then
    raise exception 'apply 20261231320000 (Groq request limits) before re-landing the Groq fallback';
  end if;
end;
$$;

update ai_ops.routing_policies rp
   set fallback_models = (
         select array_agg(x.m order by x.ord)
           from (
             -- every existing fallback, in its place (Groq never twice)
             select u.m, u.n::numeric as ord
               from unnest(rp.fallback_models) with ordinality u(m, n)
              where u.m not in ('a2000000-0000-4000-8000-000000000004'::uuid,
                                'a2000000-0000-4000-8000-000000000003'::uuid)
             union all
             -- Groq directly after gpt-5.6-luna: first among the fallbacks
             -- when luna is preferred, else right behind luna's position
             select g.m,
                    coalesce(array_position(rp.fallback_models,
                               'a2000000-0000-4000-8000-000000000009'::uuid), 0)
                      + g.k / 10.0
               from (values ('a2000000-0000-4000-8000-000000000004'::uuid, 1),
                            ('a2000000-0000-4000-8000-000000000003'::uuid, 2)) g(m, k)
              where g.k = 1
                 or rp.code in ('fast_classification.v1', 'taxonomy_mapping.v1')
           ) x
       )
 where rp.status = 'ACTIVE'
   and rp.version = 1
   and rp.code in ('normal_dialogue.v1', 'evidence_synthesis.v1',
                   'comparison.v1', 'deep_investigation.v1',
                   'fast_classification.v1', 'structured_extraction.v1',
                   'taxonomy_mapping.v1');

do $$
begin
  if (select count(*) from ai_ops.routing_policies
       where status = 'ACTIVE' and version = 1
         and 'a2000000-0000-4000-8000-000000000004'::uuid = any (fallback_models)
         and code in ('normal_dialogue.v1', 'evidence_synthesis.v1',
                      'comparison.v1', 'deep_investigation.v1',
                      'fast_classification.v1', 'structured_extraction.v1',
                      'taxonomy_mapping.v1')) <> 7 then
    raise exception 'expected Groq gpt-oss-120b on the seven active Q text policies';
  end if;
end;
$$;
