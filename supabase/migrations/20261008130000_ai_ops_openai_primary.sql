-- OpenAI is the primary model for every task class (operator decision,
-- 2026-09-24): a paid account, so free-tier rate limits and daily budgets
-- stop deciding whether Q can answer. Gemini remains as the fallback.
--
--   every active policy: gpt-5.6-luna -> gemini-3.5-flash-lite -> gemini-3.5-flash
--   (synthesis-class policies try the stronger Gemini before flash-lite)

update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000001'::uuid,
                                'a2000000-0000-4000-8000-000000000010'::uuid]
 where status = 'ACTIVE'
   and code in ('normal_dialogue.v1', 'fast_classification.v1',
                'structured_extraction.v1', 'taxonomy_mapping.v1');

update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000010'::uuid,
                                'a2000000-0000-4000-8000-000000000001'::uuid]
 where status = 'ACTIVE'
   and code in ('evidence_synthesis.v1', 'comparison.v1', 'deep_investigation.v1');
