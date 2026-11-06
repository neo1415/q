-- Premium Plan P1 (receipts/2026-11-06-q-reliability.md §1): a second
-- CONFIDENTIAL route on every active Q text policy, until Claude (the
-- owner's chosen backup, DECISIONS 62) reaches parity and its v2 policies
-- (20261231280000, RETIRED) are switched on.
--
-- Why: 20261008130000 replaced every text policy's models with OpenAI
-- gpt-5.6-luna plus Gemini, and Gemini is PUBLIC-only (20260914090000), so a
-- CONFIDENTIAL turn had exactly one eligible model. On 5 Nov the OpenAI
-- credit ran out and every model-needing Q turn had no route.
--
-- What: on the seven ACTIVE version-1 Q text policies, Groq
-- openai/gpt-oss-120b (a2...0004; CONFIDENTIAL under the zero-retention
-- review recorded in 20260914090000) is placed directly after gpt-5.6-luna,
-- and for fast_classification and taxonomy_mapping also openai/gpt-oss-20b
-- (a2...0003). Everything else keeps its place, Gemini included. Both Groq
-- models support tools and structured output, gpt-oss-120b is quality HIGH
-- (the synthesis classes' floor) and their prices exist, so the gateway can
-- plan them for every class here.
--
-- Not touched: the v2 policies, ui_translation, voice, embedding, any
-- model, provider, price, RLS policy or grant. Nothing is dropped.
--
-- Rollback (one statement): remove the Groq models from the v1 lists again.
--   update ai_ops.routing_policies
--      set fallback_models = array_remove(array_remove(fallback_models,
--            'a2000000-0000-4000-8000-000000000004'::uuid),
--            'a2000000-0000-4000-8000-000000000003'::uuid)
--    where status = 'ACTIVE' and version = 1
--      and code in ('normal_dialogue.v1', 'evidence_synthesis.v1',
--        'comparison.v1', 'deep_investigation.v1', 'fast_classification.v1',
--        'structured_extraction.v1', 'taxonomy_mapping.v1');

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
