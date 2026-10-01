-- FAST_CLASSIFICATION on Gemini flash-lite first, luna as fallback (lead
-- decision 2026-10-01, harden spec §3).
--
-- Measured over two days (ai_ops.model_usage): the readers that run on
-- every turn (DELEGATION_READER, TURN_READER) took p50 1.9 s / p90 3.5 s on
-- gpt-5.6-luna and p50 1.0 s on gemini-3.5-flash-lite, which already served
-- them as the fallback without a failure. Every other task class keeps
-- luna first. Data only: the policy row is updated in place, as
-- 20261008130000 did.

update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000001'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
                                'a2000000-0000-4000-8000-000000000010'::uuid]
 where status = 'ACTIVE'
   and code = 'fast_classification.v1';
