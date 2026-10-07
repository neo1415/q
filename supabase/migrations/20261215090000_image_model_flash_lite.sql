-- Q room W5 (R8) · the Gemini image model moves to its named replacement.
--
-- gemini-2.5-flash-image is retired; the Google image adapter now runs
-- gemini-3.1-flash-lite-image (Nano Banana 2 Lite, about $0.034 per 1K
-- image). A new catalog row rather than an edit of the old one: earlier
-- usage rows keep naming the model that actually ran.

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.1-flash-lite-image', 'gemini-image', 'IMAGE_GENERATION', 'ACTIVE',
   32000, 1, false, false, false, false, false, false, false,
   'PUBLIC', 'STANDARD', 'SLOW', '2026-10-07T00:00:00Z',
   '{"purpose":"document illustrations","note":"Paid key only (image models have no free tier). Prompts carry only a slide title, the document''s one-line description and brand colours; never figures, names or people. Max 6 per document.","cost_usd_per_image":0.034,"verified_at":"2026-10-07"}'::jsonb)
on conflict (id) do nothing;

update ai_ops.models
   set status = 'RETIRED'
 where id = 'a2000000-0000-4000-8000-000000000021'
   and model_code = 'gemini-2.5-flash-image';
