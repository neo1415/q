-- DUPLEX · full-duplex voice through the Model Gateway (flag CQ_VOICE_REALTIME,
-- off by default). Additive only:
--
--   1. ai_ops.model_usage.purpose gains VOICE_REALTIME. Every realtime
--      response's estimated cost is one ledger row under it, and the daily
--      spend cap is the sum of today's rows. Existing rows are untouched.
--   2. The catalog names the realtime model the adapter mints sessions for,
--      so ledger rows reference a real model (FK) and carry its price.
--   3. A partial index for the cap's one read: today's VOICE_REALTIME sum.
--
-- The provider row (OpenAI, UNREVIEWED, ceiling PUBLIC) is unchanged: the
-- broker refuses a line whose context plan exceeds that ceiling unless the
-- deployment holds the synthetic-demo attestation, exactly as text routing.

-- 1. Purpose ---------------------------------------------------------------

alter table ai_ops.model_usage drop constraint model_usage_purpose_check;
alter table ai_ops.model_usage add constraint model_usage_purpose_check
  check (purpose in ('CONVERSATION', 'INSTRUCTION', 'DELEGATED_WORK', 'REHEARSAL',
                     'RESEARCH', 'ONBOARDING', 'MEETING', 'DOCUMENT', 'VOICE_REALTIME',
                     'OTHER'));

-- 2. Catalog ---------------------------------------------------------------

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000003', 'gpt-realtime-mini', 'gpt-realtime', 'REALTIME', 'ACTIVE',
   32000, 4096, true, false, false, true, true, true, false,
   'PUBLIC', 'STANDARD', 'REALTIME', '2026-10-04T00:00:00Z',
   '{"purpose":"full-duplex voice (CQ_VOICE_REALTIME)","audio_prices_usd_per_million":{"input":10.0,"cached_input":0.30,"output":20.0},"note":"Session minted server-side as an ephemeral client secret; the browser never holds a key. Audio prices live here because model_prices has text columns only.","source_url":"https://developers.openai.com/api/docs/pricing","verified_at":"2026-10-04"}'::jsonb)
on conflict (id) do nothing;

insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
  batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
  ('a3000000-0000-4000-8000-000000000022', 'a2000000-0000-4000-8000-000000000022', 'global', 'USD', 0.60, 0.06, 2.40, null, null,
   'Text token prices. Audio: input 10.00, cached input 0.30, output 20.00 USD per million (models.metadata).',
   '2026-10-04T00:00:00Z', null, 'https://developers.openai.com/api/docs/pricing', '2026-10-04T00:00:00Z')
on conflict (id) do nothing;

-- 3. The cap's read --------------------------------------------------------

create index model_usage_voice_realtime_occurred_idx
  on ai_ops.model_usage (occurred_at desc) where purpose = 'VOICE_REALTIME';
