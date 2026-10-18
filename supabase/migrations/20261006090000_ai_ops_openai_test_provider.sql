-- ---------------------------------------------------------------------------
-- OpenAI as a DIAGNOSTIC provider (QX-004 core gate).
--
-- Why this row exists at all: Gemini spent a day answering "this model is
-- currently experiencing high demand" and Groq's free tier spent it
-- rate-limited. With both unreliable there was no way to tell a Capital Q
-- defect from a vendor outage, because every failing journey had the same
-- symptom — a degraded turn and an empty session. A provider that answers
-- reliably is what makes the core acceptance suite executable.
--
-- It is NOT named in any routing policy's preferred or fallback list, so
-- ordinary traffic cannot reach it. Reaching it requires a deployment to
-- turn on the server-side test route (CQ_TEST_MODEL_PROVIDER), which is
-- refused outside a local or test environment and refused without the
-- synthetic-demo attestation. No browser can ask for it.
--
-- Privacy class: UNREVIEWED, and the ceiling is PUBLIC accordingly. The
-- OpenAI API's terms were not verified from a primary document for this
-- account, and a working key is not evidence of anything. Raising either
-- is a reviewed data change, never a code change.
-- ---------------------------------------------------------------------------

insert into ai_ops.providers (id, code, name, status, region_support, privacy_policy_class, supports_zero_retention, supports_byo_key, metadata) values
  ('a1000000-0000-4000-8000-000000000003', 'openai', 'OpenAI Platform', 'ACTIVE', '["global"]'::jsonb,
   'UNREVIEWED', false, true,
   '{"review_status":"UNREVIEWED","purpose":"diagnostic-only","note":"Added to isolate Capital Q defects from Gemini/Groq outages during the QX-004 core gate. Not in any routing policy; reachable only through the server-side test route.","terms_url":"https://openai.com/policies/","verified_at":"2026-09-22"}'::jsonb)
on conflict (id) do nothing;

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000003', 'gpt-5.6-luna', 'gpt-5.6', 'TEXT_GENERATION', 'ACTIVE',
   400000, 128000, true, true, true, false, false, true, true,
   'PUBLIC', 'STANDARD', 'FAST', '2026-09-22T00:00:00Z',
   '{"purpose":"diagnostic-only","note":"The only OpenAI model the adapter will run; the account holds a few dollars and an expensive model would spend them silently.","verified_at":"2026-09-22"}'::jsonb)
on conflict (id) do nothing;

-- A price, because the gateway refuses a route it cannot cost — "unknown
-- price is not free: with a ceiling to honour, a route we cannot cost is a
-- route we cannot take".
--
-- These are the ordinary published API rates for this model. An earlier
-- revision of this migration carried deliberately high placeholder
-- figures so that the cost ceiling would bind early; that was the wrong
-- thing to leave behind. A catalogue price is read by the gateway to
-- decide whether a route is affordable and by the usage ledger to say
-- what a run cost, and a knowingly false number makes both of those
-- answers false. Being wrong in a safe direction is still being wrong.
--
-- Batch rates are left null rather than guessed: nothing here uses the
-- batch API, and an invented figure is the fault this comment exists to
-- record. Long-context and other special billing conditions are not
-- modelled by this table, so a run that meets them will be under-costed;
-- that is a known limit of the schema, not of this row.
insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
  batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
  ('a3000000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000009', 'global', 'USD', 0.20, 0.02, 1.20, null, null,
   'Standard API rates. No free tier.',
   '2026-09-22T00:00:00Z', null, 'https://openai.com/api/pricing/', '2026-09-22T00:00:00Z')
on conflict (id) do nothing;
