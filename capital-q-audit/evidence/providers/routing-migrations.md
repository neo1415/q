# Routing policy history (ai_ops)

Why included: Net routing table is the product of these in timestamp order.

## `supabase/migrations/20260907090000_ai_ops_model_gateway.sql` lines 245-329

```sql
  245  
  246  -- ---------------------------------------------------------------------------
  247  -- Seed: the two V1 providers, four verified models, price snapshots and
  248  -- routing policy v1. Operational configuration (packet §12-§19), verified
  249  -- against provider documentation on 2026-09-05 — not locked product truth.
  250  -- Fixed ids so the rows are addressable from tests and later migrations.
  251  --
  252  -- Data-use decisions recorded here (doc 15 §61-62; packet §22-§23):
  253  --   google  UNREVIEWED. The Gemini Developer API free tier states that
  254  --           content is used to improve Google products; no paid-tier or
  255  --           enterprise configuration has been reviewed. Ceiling PUBLIC:
  256  --           synthetic and public material only.
  257  --   groq    UNREVIEWED. Provider documentation describes no training and
  258  --           no default retention, but the governing Services Agreement
  259  --           could not be verified from a primary document. Ceiling
  260  --           INTERNAL. Raising either ceiling is a reviewed data change,
  261  --           never a code change, and never inferred from a working key.
  262  -- ---------------------------------------------------------------------------
  263  
  264  insert into ai_ops.providers (id, code, name, status, region_support, privacy_policy_class, supports_zero_retention, supports_byo_key, metadata) values
  265    ('a1000000-0000-4000-8000-000000000001', 'google', 'Google Gemini Developer API', 'ACTIVE', '["global"]'::jsonb,
  266     'UNREVIEWED', false, true,
  267     '{"review_status":"UNREVIEWED","account_tier":"unverified","note":"Free-tier terms: content used to improve Google products. Paid-tier treatment differs and is unverified for this account.","terms_url":"https://ai.google.dev/gemini-api/docs/pricing","verified_at":"2026-09-05"}'::jsonb),
  268    ('a1000000-0000-4000-8000-000000000002', 'groq', 'GroqCloud', 'ACTIVE', '["global"]'::jsonb,
  269     'UNREVIEWED', false, true,
  270     '{"review_status":"UNREVIEWED","note":"Documentation describes no training on inference data and no default retention; the Groq Services Agreement was not verified from a primary document.","terms_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05"}'::jsonb);
  271  
  272  insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  273    supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  274    sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  275    ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.5-flash-lite', 'gemini-3.5', 'TEXT_GENERATION', 'ACTIVE',
  276     1048576, 65536, true, true, true, true, false, true, true,
  277     'PUBLIC', 'STANDARD', 'FAST', '2026-09-05T00:00:00Z',
  278     '{"source_url":"https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite","verified_at":"2026-09-05"}'::jsonb),
  279    ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.8-flash', 'gemini-3.8', 'TEXT_GENERATION', 'ACTIVE',
  280     1048576, 65536, true, true, true, true, false, true, true,
  281     'PUBLIC', 'HIGH', 'STANDARD', '2026-09-05T00:00:00Z',
  282     '{"source_url":"https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash","verified_at":"2026-09-05"}'::jsonb),
  283    ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'openai/gpt-oss-20b', 'gpt-oss', 'TEXT_GENERATION', 'ACTIVE',
  284     131072, 65536, true, true, false, false, false, false, true,
  285     'INTERNAL', 'STANDARD', 'FAST', '2026-09-05T00:00:00Z',
  286     '{"source_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05","rate_limits":{"tpm":250000,"rpm":1000}}'::jsonb),
  287    ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'openai/gpt-oss-120b', 'gpt-oss', 'TEXT_GENERATION', 'ACTIVE',
  288     131072, 65536, true, true, false, false, false, false, true,
  289     'INTERNAL', 'HIGH', 'FAST', '2026-09-05T00:00:00Z',
  290     '{"source_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05","rate_limits":{"tpm":250000,"rpm":1000}}'::jsonb);
  291  
  292  insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
  293    batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
  294    ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'global', 'USD', 0.30, 0.03, 2.50, 0.15, 1.25,
  295     'Free tier available; free-tier content is used to improve Google products.',
  296     '2026-09-05T00:00:00Z', null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  297    ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'global', 'USD', 0.75, 0.075, 3.75, 0.375, 1.875,
  298     'Introductory paid price through 2026-12-31; free tier available with content used to improve Google products.',
  299     '2026-09-05T00:00:00Z', '2027-01-01T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  300    ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'global', 'USD', 1.50, 0.15, 7.50, 0.75, 3.75,
  301     'Announced standard price from 2027-01-01.',
  302     '2027-01-01T00:00:00Z', null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  303    ('a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000003', 'global', 'USD', 0.075, null, 0.30, null, null,
  304     'Developer plan rate limits apply; no free-tier price listed.',
  305     '2026-09-05T00:00:00Z', null, 'https://console.groq.com/docs/models', '2026-09-05T00:00:00Z'),
  306    ('a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000004', 'global', 'USD', 0.15, null, 0.60, null, null,
  307     'Developer plan rate limits apply; no free-tier price listed.',
  308     '2026-09-05T00:00:00Z', null, 'https://console.groq.com/docs/models', '2026-09-05T00:00:00Z');
  309  
  310  -- Routing policy v1 (packet §13): the initial MVP routing hypothesis. Each
  311  -- policy covers every sensitivity up to RESTRICTED; per-candidate
  312  -- eligibility — never the policy — decides what a sensitive request may
  313  -- reach. CQ-Q-010 evals decide model quality; nothing here claims it.
  314  insert into ai_ops.routing_policies (id, code, task_class, sensitivity_class, quality_floor, latency_target_ms, cost_ceiling_usd,
  315    preferred_models, fallback_models, allow_free_router, status, version) values
  316    ('a4000000-0000-4000-8000-000000000001', 'fast_classification.v1', 'FAST_CLASSIFICATION', 'RESTRICTED', 'BASIC', 5000, 0.02,
  317     '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  318    ('a4000000-0000-4000-8000-000000000002', 'structured_extraction.v1', 'STRUCTURED_EXTRACTION', 'RESTRICTED', 'BASIC', 15000, 0.05,
  319     '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  320    ('a4000000-0000-4000-8000-000000000003', 'taxonomy_mapping.v1', 'TAXONOMY_MAPPING', 'RESTRICTED', 'BASIC', 5000, 0.02,
  321     '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  322    ('a4000000-0000-4000-8000-000000000004', 'normal_dialogue.v1', 'NORMAL_DIALOGUE', 'RESTRICTED', 'STANDARD', 20000, 0.10,
  323     '{a2000000-0000-4000-8000-000000000004}', '{a2000000-0000-4000-8000-000000000002}', false, 'ACTIVE', 1),
  324    ('a4000000-0000-4000-8000-000000000005', 'evidence_synthesis.v1', 'EVIDENCE_SYNTHESIS', 'RESTRICTED', 'HIGH', 60000, 0.50,
  325     '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1),
  326    ('a4000000-0000-4000-8000-000000000006', 'comparison.v1', 'COMPARISON', 'RESTRICTED', 'HIGH', 60000, 0.50,
  327     '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1),
  328    ('a4000000-0000-4000-8000-000000000007', 'deep_investigation.v1', 'DEEP_INVESTIGATION', 'RESTRICTED', 'HIGH', 120000, 1.00,
  329     '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1);
```

## `supabase/migrations/20260926090000_restore_reviewed_google_posture.sql` lines 1-40

```sql
    1  -- Restore the reviewed provider posture for Google Gemini (CQ-REC-002R).
    2  --
    3  -- Migrations 20260919 (model ceilings → CONFIDENTIAL) and 20260921
    4  -- (provider class → ENTERPRISE_CONTRACT) recorded a demo posture: "for demo
    5  -- and development traffic only", with the vendor's actual terms unchanged
    6  -- and unreviewed. Inspection against the locked sources shows that posture
    7  -- cannot stand as data:
    8  --
    9  --   * doc 13 §57.2 and doc 15 §62: free Gemini endpoints are not eligible
   10  --     for private Capital Q customer data until terms are reviewed; "free"
   11  --     is a cost property, not a privacy classification;
   12  --   * the gateway derives a provider's justified ceiling from its privacy
   13  --     class (CQ-C5-R2A), so relabelling the class as ENTERPRISE_CONTRACT
   14  --     does not describe a demo — it clears confidential customer material
   15  --     for the vendor in every environment the migration reaches, hosted
   16  --     included;
   17  --   * config's deployment environment is operational metadata and "no
   18  --     permission decision may depend on it", so there is no legitimate
   19  --     environment-scoped provider eligibility to express here;
   20  --   * the repository's own database tests (rls/320_ai_ops) assert
   21  --     google = UNREVIEWED and Gemini ceilings = PUBLIC.
   22  --
   23  -- What the demo intent legitimately allows is kept: migration 20260920's
   24  -- routing preference (Gemini first for dialogue, synthesis and extraction)
   25  -- stays, and takes effect exactly where Gemini is eligible — PUBLIC work,
   26  -- synthetic development data, and any request a reviewed paid tier later
   27  -- justifies. Confidential customer traffic routes to the provider whose
   28  -- reviewed terms carry it (Groq under zero retention), as before 20260919.
   29  --
   30  -- The rows keep their history: the demo-posture metadata is retained with
   31  -- `demo_posture = false` and a restoration note, and the model ceilings
   32  -- return to the value the provider review justifies.
   33  
   34  update ai_ops.providers
   35  set
   36    privacy_policy_class = 'UNREVIEWED',
   37    metadata = metadata || jsonb_build_object(
   38      'demo_posture', false,
   39      'demo_posture_restored_at', '2026-09-18',
   40      'demo_posture_restoration_note',
```

## `supabase/migrations/20261006090000_ai_ops_openai_test_provider.sql` lines 1-60

```sql
    1  -- ---------------------------------------------------------------------------
    2  -- OpenAI as a DIAGNOSTIC provider (QX-004 core gate).
    3  --
    4  -- Why this row exists at all: Gemini spent a day answering "this model is
    5  -- currently experiencing high demand" and Groq's free tier spent it
    6  -- rate-limited. With both unreliable there was no way to tell a Capital Q
    7  -- defect from a vendor outage, because every failing journey had the same
    8  -- symptom — a degraded turn and an empty session. A provider that answers
    9  -- reliably is what makes the core acceptance suite executable.
   10  --
   11  -- It is NOT named in any routing policy's preferred or fallback list, so
   12  -- ordinary traffic cannot reach it. Reaching it requires a deployment to
   13  -- turn on the server-side test route (CQ_TEST_MODEL_PROVIDER), which is
   14  -- refused outside a local or test environment and refused without the
   15  -- synthetic-demo attestation. No browser can ask for it.
   16  --
   17  -- Privacy class: UNREVIEWED, and the ceiling is PUBLIC accordingly. The
   18  -- OpenAI API's terms were not verified from a primary document for this
   19  -- account, and a working key is not evidence of anything. Raising either
   20  -- is a reviewed data change, never a code change.
   21  -- ---------------------------------------------------------------------------
   22  
   23  insert into ai_ops.providers (id, code, name, status, region_support, privacy_policy_class, supports_zero_retention, supports_byo_key, metadata) values
   24    ('a1000000-0000-4000-8000-000000000003', 'openai', 'OpenAI Platform', 'ACTIVE', '["global"]'::jsonb,
   25     'UNREVIEWED', false, true,
   26     '{"review_status":"UNREVIEWED","purpose":"diagnostic-only","note":"Added to isolate Capital Q defects from Gemini/Groq outages during the QX-004 core gate. Not in any routing policy; reachable only through the server-side test route.","terms_url":"https://openai.com/policies/","verified_at":"2026-09-22"}'::jsonb)
   27  on conflict (id) do nothing;
   28  
   29  insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
   30    supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
   31    sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
   32    ('a2000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000003', 'gpt-5.6-luna', 'gpt-5.6', 'TEXT_GENERATION', 'ACTIVE',
   33     400000, 128000, true, true, true, false, false, true, true,
   34     'PUBLIC', 'STANDARD', 'FAST', '2026-09-22T00:00:00Z',
   35     '{"purpose":"diagnostic-only","note":"The only OpenAI model the adapter will run; the account holds a few dollars and an expensive model would spend them silently.","verified_at":"2026-09-22"}'::jsonb)
   36  on conflict (id) do nothing;
   37  
   38  -- A price, because the gateway refuses a route it cannot cost — "unknown
   39  -- price is not free: with a ceiling to honour, a route we cannot cost is a
   40  -- route we cannot take".
   41  --
   42  -- These are the ordinary published API rates for this model. An earlier
   43  -- revision of this migration carried deliberately high placeholder
   44  -- figures so that the cost ceiling would bind early; that was the wrong
   45  -- thing to leave behind. A catalogue price is read by the gateway to
   46  -- decide whether a route is affordable and by the usage ledger to say
   47  -- what a run cost, and a knowingly false number makes both of those
   48  -- answers false. Being wrong in a safe direction is still being wrong.
   49  --
   50  -- Batch rates are left null rather than guessed: nothing here uses the
   51  -- batch API, and an invented figure is the fault this comment exists to
   52  -- record. Long-context and other special billing conditions are not
   53  -- modelled by this table, so a run that meets them will be under-costed;
   54  -- that is a known limit of the schema, not of this row.
   55  insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
   56    batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
   57    ('a3000000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000009', 'global', 'USD', 0.20, 0.02, 1.20, null, null,
   58     'Standard API rates. No free tier.',
   59     '2026-09-22T00:00:00Z', null, 'https://openai.com/api/pricing/', '2026-09-22T00:00:00Z')
   60  on conflict (id) do nothing;
```

## `supabase/migrations/20261006100000_ai_ops_openai_dialogue_fallback.sql` lines 1-44

```sql
    1  -- OpenAI as the first fallback for the interview (QX-004 core gate).
    2  --
    3  -- The dialogue policy ran on Gemini with two free-tier Groq models behind
    4  -- it. When Gemini returned 504s (2026-09-23, EU) the person heard "I can't
    5  -- reach my reasoning service" mid-sentence: the free tier was saturated or
    6  -- refused the request outright. The operator's decision is that a paid,
    7  -- reviewed provider stands behind Gemini so a vendor outage degrades to a
    8  -- slower turn rather than a lost one.
    9  --
   10  -- Review basis (ai_ops.providers.privacy_policy_class is the review policy,
   11  -- written once in packages/model-gateway/src/policy/eligibility.ts):
   12  --   OpenAI's API terms state API inputs and outputs are not used to train
   13  --   models, and Zero Data Retention is offered for eligible API usage
   14  --   (https://openai.com/policies/ and the enterprise privacy page,
   15  --   verified 2026-09-23). The class describes what the vendor OFFERS;
   16  --   supports_zero_retention records what THIS account has ENABLED. Without
   17  --   both, the effective ceiling stays INTERNAL and no interview turn will
   18  --   route here. The operator asserts ZDR is enabled on the Capital Q
   19  --   OpenAI organisation; if that is not the case, set
   20  --   supports_zero_retention = false and this provider serves nothing
   21  --   confidential.
   22  --
   23  -- Not a general provider: the adapter runs one model (gpt-5.6-luna) and
   24  -- refuses every other before opening a socket. Cost is bounded by the
   25  -- policy's own cost ceiling per call.
   26  
   27  update ai_ops.providers
   28  set privacy_policy_class = 'NO_TRAINING_ZERO_RETENTION',
   29      supports_zero_retention = true,
   30      metadata = metadata || '{"review_status":"REVIEWED","purpose":"dialogue-fallback","reviewed_at":"2026-09-23","review_basis":"OpenAI API terms: inputs/outputs not used for training; Zero Data Retention offered for eligible API usage. supports_zero_retention records that ZDR is enabled on this organisation.","terms_url":"https://openai.com/policies/"}'::jsonb
   31  where code = 'openai';
   32  
   33  update ai_ops.models
   34  set sensitivity_ceiling = 'CONFIDENTIAL',
   35      metadata = metadata || '{"purpose":"dialogue-fallback","ceiling_basis":"ai_ops.providers.privacy_policy_class = NO_TRAINING_ZERO_RETENTION with zero data retention enabled (openai, 2026-09-23)"}'::jsonb
   36  where id = 'a2000000-0000-4000-8000-000000000009';
   37  
   38  -- First fallback: tried as soon as the preferred model fails, before the
   39  -- free-tier models. Idempotent: not re-added if already present.
   40  update ai_ops.routing_policies
   41  set fallback_models = array_prepend('a2000000-0000-4000-8000-000000000009'::uuid,
   42        array_remove(fallback_models, 'a2000000-0000-4000-8000-000000000009'::uuid))
   43  where code = 'normal_dialogue.v1'
   44    and status = 'ACTIVE';
```

## `supabase/migrations/20261008120000_ai_ops_demo_routing_gemini_openai.sql` lines 1-75

```sql
    1  -- Demo routing: Gemini and OpenAI only (operator decision, 2026-09-24).
    2  --
    3  -- The operator's instruction for the synthetic demo: every model they
    4  -- provide may carry any task; data-handling review of each provider is a
    5  -- launch decision they will make before real customers. On the demo
    6  -- deployments the synthetic-demo attestation already lifts the
    7  -- sensitivity ceilings (eligibility.ts); what still broke real work was:
    8  --
    9  --   * Groq's free tier: RATE_LIMIT on almost every call, and its 8k request
   10  --     window bounded every prompt. Dropped from every policy.
   11  --   * gemini-3.8-flash / gemini-3.7-flash: 503 UNAVAILABLE on every probe
   12  --     (2026-09-24) and every hosted call. Dropped.
   13  --   * The HIGH quality floor on evidence synthesis, comparison and deep
   14  --     investigation: after the above, no model met it, so deck building and
   15  --     reviews failed outright. Floors set to STANDARD for the demo; the
   16  --     policy version is unchanged in shape so a launch migration can raise
   17  --     them again with reviewed models.
   18  --
   19  -- Added: gemini-3.5-flash (200 OK, ~2.7 s on 2026-09-24 probes) as the
   20  -- stronger Gemini for synthesis-class work. Its price row is an operator
   21  -- estimate for cost ceilings only; verify against the pricing page before
   22  -- launch (recorded in free_tier_description).
   23  --
   24  -- Result, per policy: preferred first, then fallbacks.
   25  --   dialogue / classification / extraction / taxonomy:
   26  --       gemini-3.5-flash-lite -> gpt-5.6-luna -> gemini-3.5-flash
   27  --   evidence synthesis / comparison / deep investigation:
   28  --       gemini-3.5-flash -> gpt-5.6-luna -> gemini-3.5-flash-lite
   29  
   30  insert into ai_ops.models (
   31    id, provider_id, model_code, model_family, model_type, status,
   32    context_window, max_output_tokens, supports_tools, supports_structured_output,
   33    supports_vision, supports_audio, supports_realtime, supports_prompt_cache,
   34    supports_reasoning, sensitivity_ceiling, quality_class, latency_class,
   35    effective_from, metadata)
   36  select 'a2000000-0000-4000-8000-000000000010', m.provider_id, 'gemini-3.5-flash',
   37         'gemini-3.5', 'TEXT_GENERATION', 'ACTIVE',
   38         m.context_window, m.max_output_tokens, true, true,
   39         true, true, false, true,
   40         true, m.sensitivity_ceiling, 'HIGH', 'STANDARD',
   41         '2026-09-24T00:00:00Z',
   42         '{"purpose":"demo synthesis-class model","probed":"2026-09-24 200 OK ~2.7s"}'::jsonb
   43    from ai_ops.models m
   44   where m.id = 'a2000000-0000-4000-8000-000000000001'
   45  on conflict (id) do nothing;
   46  
   47  insert into ai_ops.model_prices (
   48    id, model_id, pricing_region, currency, input_per_million,
   49    cached_input_per_million, output_per_million, free_tier_description,
   50    effective_from, source_url, verified_at)
   51  values (
   52    'a3000000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000010',
   53    'global', 'USD', 0.600000, 0.060000, 3.500000,
   54    'Operator estimate recorded 2026-09-24 for demo cost ceilings; verify before launch.',
   55    '2026-09-24T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing',
   56    '2026-09-24T00:00:00Z')
   57  on conflict (id) do nothing;
   58  
   59  -- Everyday task classes: flash-lite first, OpenAI as the reliable fallback.
   60  update ai_ops.routing_policies
   61     set preferred_models = array['a2000000-0000-4000-8000-000000000001'::uuid],
   62         fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
   63                                  'a2000000-0000-4000-8000-000000000010'::uuid]
   64   where status = 'ACTIVE'
   65     and code in ('normal_dialogue.v1', 'fast_classification.v1',
   66                  'structured_extraction.v1', 'taxonomy_mapping.v1');
   67  
   68  -- Synthesis-class work: the stronger Gemini first.
   69  update ai_ops.routing_policies
   70     set preferred_models = array['a2000000-0000-4000-8000-000000000010'::uuid],
   71         fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
   72                                  'a2000000-0000-4000-8000-000000000001'::uuid],
   73         quality_floor    = 'STANDARD'
   74   where status = 'ACTIVE'
   75     and code in ('evidence_synthesis.v1', 'comparison.v1', 'deep_investigation.v1');
```

## `supabase/migrations/20261008130000_ai_ops_openai_primary.sql` lines 1-21

```sql
    1  -- OpenAI is the primary model for every task class (operator decision,
    2  -- 2026-09-24): a paid account, so free-tier rate limits and daily budgets
    3  -- stop deciding whether Q can answer. Gemini remains as the fallback.
    4  --
    5  --   every active policy: gpt-5.6-luna -> gemini-3.5-flash-lite -> gemini-3.5-flash
    6  --   (synthesis-class policies try the stronger Gemini before flash-lite)
    7  
    8  update ai_ops.routing_policies
    9     set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
   10         fallback_models  = array['a2000000-0000-4000-8000-000000000001'::uuid,
   11                                  'a2000000-0000-4000-8000-000000000010'::uuid]
   12   where status = 'ACTIVE'
   13     and code in ('normal_dialogue.v1', 'fast_classification.v1',
   14                  'structured_extraction.v1', 'taxonomy_mapping.v1');
   15  
   16  update ai_ops.routing_policies
   17     set preferred_models = array['a2000000-0000-4000-8000-000000000009'::uuid],
   18         fallback_models  = array['a2000000-0000-4000-8000-000000000010'::uuid,
   19                                  'a2000000-0000-4000-8000-000000000001'::uuid]
   20   where status = 'ACTIVE'
   21     and code in ('evidence_synthesis.v1', 'comparison.v1', 'deep_investigation.v1');
```

## `supabase/migrations/20261110000000_ai_ops_fast_classification_flash_lite_first.sql` lines 1-16

```sql
    1  -- FAST_CLASSIFICATION on Gemini flash-lite first, luna as fallback (lead
    2  -- decision 2026-10-01, harden spec §3).
    3  --
    4  -- Measured over two days (ai_ops.model_usage): the readers that run on
    5  -- every turn (DELEGATION_READER, TURN_READER) took p50 1.9 s / p90 3.5 s on
    6  -- gpt-5.6-luna and p50 1.0 s on gemini-3.5-flash-lite, which already served
    7  -- them as the fallback without a failure. Every other task class keeps
    8  -- luna first. Data only: the policy row is updated in place, as
    9  -- 20261008130000 did.
   10  
   11  update ai_ops.routing_policies
   12     set preferred_models = array['a2000000-0000-4000-8000-000000000001'::uuid],
   13         fallback_models  = array['a2000000-0000-4000-8000-000000000009'::uuid,
   14                                  'a2000000-0000-4000-8000-000000000010'::uuid]
   15   where status = 'ACTIVE'
   16     and code = 'fast_classification.v1';
```

## `supabase/migrations/20261207163000_ai_ops_routing_hedge.sql` lines 1-36

```sql
    1  -- L1 latency sweep (2026-10-06): hedged requests, configured per routing
    2  -- policy.
    3  --
    4  -- hedge_after_ms: when the first model of a non-streaming request has not
    5  -- answered within this many milliseconds and another eligible model waits
    6  -- behind it, the gateway asks that model too, without stopping the first;
    7  -- the first acceptable answer is used and the other attempt is cancelled.
    8  -- NULL keeps the old behaviour (fall back only after a failure).
    9  --
   10  -- FAST_CLASSIFICATION, hosted ledger 2026-10-05 (gemini-3.5-flash-lite,
   11  -- n=192 successes): p50 1172 ms, p90 1479 ms, max 2298 ms. 2000 ms sits
   12  -- past the healthy p99, so a hedge (to gpt-5.6-luna, paid from the
   13  -- founder's OpenAI credit) is paid for only by a call that is genuinely
   14  -- stalling, and a stalled primary no longer holds a person's turn for the
   15  -- 6 s attempt timeout.
   16  --
   17  -- Streaming requests (a voice answer being spoken) are never hedged: two
   18  -- models must not both speak.
   19  --
   20  -- pgTAP note: ai_ops has no client grants (service_role and postgres only,
   21  -- 20260907090000); the new column inherits the table-level grants and the
   22  -- RLS-with-no-policy posture, so no new grant, policy or test surface.
   23  -- Covered by the check constraint and the gateway's catalog parse.
   24  
   25  alter table ai_ops.routing_policies
   26    add column hedge_after_ms integer
   27      constraint routing_policies_hedge_after_ms_range
   28        check (hedge_after_ms is null or hedge_after_ms between 100 and 60000);
   29  
   30  comment on column ai_ops.routing_policies.hedge_after_ms is
   31    'Milliseconds after which a non-streaming request also asks the next eligible model (hedged request). NULL: no hedge.';
   32  
   33  update ai_ops.routing_policies
   34     set hedge_after_ms = 2000
   35   where status = 'ACTIVE'
   36     and code = 'fast_classification.v1';
```

