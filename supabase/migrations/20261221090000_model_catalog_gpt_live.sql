-- V · GPT-Live voice (flag CQ_VOICE_LIVE, off by default). Additive only.
--
-- The catalog names gpt-live-1 so the live line's ledger rows reference
-- their own model (FK) instead of the realtime row. Usage stays under the
-- existing VOICE_REALTIME purpose, so the daily realtime spend cap
-- (20261203090000's partial index) covers both voice lines.
--
-- GPT-Live is billed per second of session ($0.05 per minute), not per
-- token: model_prices has token columns only, so they are null and the
-- per-second price lives in models.metadata, as the realtime row keeps its
-- audio prices there. The provider row (OpenAI, UNREVIEWED, ceiling PUBLIC)
-- is unchanged.

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000023', 'a1000000-0000-4000-8000-000000000003', 'gpt-live-1', 'gpt-live', 'REALTIME', 'ACTIVE',
   32000, 4096, false, false, false, true, true, false, false,
   'PUBLIC', 'STANDARD', 'REALTIME', '2026-10-09T00:00:00Z',
   '{"purpose":"conversational voice with client delegation to Q (CQ_VOICE_LIVE)","price_usd_per_second":0.000833333,"price_usd_per_minute":0.05,"note":"Session created server-side (WebRTC SDP exchange); the browser never holds a key. Billed per second of session; 15 s billed at WebRTC session creation and credited against duration.","source_url":"https://developers.openai.com/api/docs/guides/live","verified_at":"2026-10-09","bounds_note":"context_window and max_output_tokens are placeholders (not published for gpt-live-1); nothing routes on them"}'::jsonb)
on conflict (id) do nothing;
