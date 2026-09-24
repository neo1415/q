-- Demo routing: Gemini and OpenAI only (operator decision, 2026-09-24).
--
-- The operator's instruction for the synthetic demo: every model they
-- provide may carry any task; data-handling review of each provider is a
-- launch decision they will make before real customers. On the demo
-- deployments the synthetic-demo attestation already lifts the
-- sensitivity ceilings (eligibility.ts); what still broke real work was:
--
--   * Groq's free tier: RATE_LIMIT on almost every call, and its 8k request
--     window bounded every prompt. Dropped from every policy.
--   * gemini-3.8-flash / gemini-3.7-flash: 503 UNAVAILABLE on every probe
--     (2026-09-24) and every hosted call. Dropped.
--   * The HIGH quality floor on evidence synthesis, comparison and deep
--     investigation: after the above, no model met it, so deck building and
--     reviews failed outright. Floors set to STANDARD for the demo; the
--     policy version is unchanged in shape so a launch migration can raise
--     them again with reviewed models.
--
-- Added: gemini-3.5-flash (200 OK, ~2.7 s on 2026-09-24 probes) as the
-- stronger Gemini for synthesis-class work. Its price row is an operator
-- estimate for cost ceilings only; verify against the pricing page before
-- launch (recorded in free_tier_description).
--
-- Result, per policy: preferred first, then fallbacks.
--   dialogue / classification / extraction / taxonomy:
--       gemini-3.5-flash-lite -> gpt-5.6-luna -> gemini-3.5-flash
--   evidence synthesis / comparison / deep investigation:
--       gemini-3.5-flash -> gpt-5.6-luna -> gemini-3.5-flash-lite

insert into ai_ops.models (
  id, provider_id, model_code, model_family, model_type, status,
  context_window, max_output_tokens, supports_tools, supports_structured_output,
  supports_vision, supports_audio, supports_realtime, supports_prompt_cache,
  supports_reasoning, sensitivity_ceiling, quality_class, latency_class,
  effective_from, metadata)
select 'a2000000-0000-4000-8000-000000000010', m.provider_id, 'gemini-3.5-flash',
       'gemini-3.5', 'TEXT_GENERATION', 'ACTIVE',
       m.context_window, m.max_output_tokens, true, true,
       true, true, false, true,
       true, m.sensitivity_ceiling, 'HIGH', 'STANDARD',
       '2026-09-24T00:00:00Z',
       '{"purpose":"demo synthesis-class model","probed":"2026-09-24 200 OK ~2.7s"}'::jsonb
  from ai_ops.models m
 where m.id = 'a2000000-0000-4000-8000-000000000001'
on conflict (id) do nothing;

insert into ai_ops.model_prices (
  id, model_id, pricing_region, currency, input_per_million,
  cached_input_per_million, output_per_million, free_tier_description,
  effective_from, source_url, verified_at)
values (
  'a3000000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000010',
  'global', 'USD', 0.600000, 0.060000, 3.500000,
  'Operator estimate recorded 2026-09-24 for demo cost ceilings; verify before launch.',
  '2026-09-24T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing',
  '2026-09-24T00:00:00Z')
on conflict (id) do nothing;

-- Everyday task classes: flash-lite first, OpenAI as the reliable fallback.
update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000001'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
                                'a2000000-0000-4000-8000-000000000010'::uuid]
 where status = 'ACTIVE'
   and code in ('normal_dialogue.v1', 'fast_classification.v1',
                'structured_extraction.v1', 'taxonomy_mapping.v1');

-- Synthesis-class work: the stronger Gemini first.
update ai_ops.routing_policies
   set preferred_models = array['a2000000-0000-4000-8000-000000000010'::uuid],
       fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
                                'a2000000-0000-4000-8000-000000000001'::uuid],
       quality_floor    = 'STANDARD'
 where status = 'ACTIVE'
   and code in ('evidence_synthesis.v1', 'comparison.v1', 'deep_investigation.v1');
