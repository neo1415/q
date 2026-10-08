-- RECOVERY F7 (audit F-D1): the Gemini image model gets its own catalog row.
--
-- 20261215090000 inserted gemini-3.1-flash-lite-image under id
-- a2000000-…-000000000022, which 20261203090000 had already given to
-- gpt-realtime-mini. Both insert with `on conflict (id) do nothing`, so the
-- image row was never written and every Google image usage row since has
-- named the realtime voice model. This inserts the image model under an id
-- from F's band; packages/model-gateway/src/images/config.ts points at it.
--
-- Usage rows already written stay as they are: ai_ops.model_usage is
-- append-only, and a correction is this new row going forward, not a
-- rewrite. They are identifiable (purpose IMAGE, model …022, provider
-- google) for any report that needs to reattribute them.

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000190001', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.1-flash-lite-image', 'gemini-image', 'IMAGE_GENERATION', 'ACTIVE',
   32000, 1, false, false, false, false, false, false, false,
   'PUBLIC', 'STANDARD', 'SLOW', '2026-10-07T00:00:00Z',
   '{"purpose":"document illustrations","note":"Paid key only (image models have no free tier). Prompts carry only a slide title, the document''s one-line description and brand colours; never figures, names or people. Max 6 per document.","cost_usd_per_image":0.034,"verified_at":"2026-10-07","catalog_fix":"20261220192000: the id 20261215090000 chose was already gpt-realtime-mini"}'::jsonb)
on conflict (provider_id, model_code) do nothing;
