-- CQ-Q-VOICE-001 rework: a conversation must not stall because one model's
-- free-tier quota for the minute is spent. Groq enforces tokens-per-minute
-- per model, so every additional model that can return strict JSON-schema
-- output is a quota of its own. qwen/qwen3.8-27b is the third such model
-- on Groq (with openai/gpt-oss-120b and openai/gpt-oss-20b); it is placed
-- behind them for NORMAL_DIALOGUE, with the Google fallback retained last
-- for environments that hold a key and a policy that permits it.

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'qwen/qwen3.8-27b', 'qwen3.8', 'TEXT_GENERATION', 'ACTIVE',
   131072, 32768, true, true, false, false, false, false, true,
   'CONFIDENTIAL', 'STANDARD', 'FAST', '2026-09-15T00:00:00Z',
   '{"source_url":"https://console.groq.com/docs/models","verified_at":"2026-09-15","rate_limits":{"free_tier":{"rpm":30,"rpd":1000,"tpm":8000,"tpd":200000}},"structured_output":"json_schema strict (console.groq.com/docs/structured-outputs, 2026-09-15)","ceiling_basis":"ai_ops.providers.privacy_policy_class = NO_TRAINING_ZERO_RETENTION with zero data retention enabled (groq.v1, 2026-09-08)"}'::jsonb);

insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
  batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
  ('a3000000-0000-4000-8000-000000000021', 'a2000000-0000-4000-8000-000000000005', 'global', 'USD', 0.24, null, 0.90, null, null,
   'Free tier: 30 RPM, 1K RPD, 8K TPM, 200K TPD (console.groq.com/docs/rate-limits, 2026-09-15). The price is taken from a third-party listing, not the vendor page; treat cost figures for this model as estimates until verified.',
   '2026-09-15T00:00:00Z', null, 'https://pricepertoken.com/pricing-page/model/qwen-qwen3.8-27b', '2026-09-15T00:00:00Z');

update ai_ops.routing_policies
set fallback_models = '{a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005,a2000000-0000-4000-8000-000000000002}'
where code = 'normal_dialogue.v1';
