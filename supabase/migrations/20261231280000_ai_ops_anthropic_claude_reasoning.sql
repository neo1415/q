-- DECISIONS 62 (owner, 2026-11-06): Claude for reasoning, OpenAI for voice.
-- OpenAI stays the fallback for every reasoning task.
--
-- What this adds, and nothing else:
--
--   1. ai_ops.providers gains owner_approved_ceiling / owner_approval_ref:
--      a ceiling the owner approved by recorded decision, above what the
--      privacy class alone justifies. The gateway applies it only to a
--      provider whose class is at least contractually no-training, never
--      above CONFIDENTIAL, and only with a decision reference beside it
--      (the same rules are checks here). Every existing row is NULL, so no
--      existing provider's eligibility changes.
--   2. The Anthropic provider row, classed honestly: the API's commercial
--      terms exclude training on inputs, zero data retention is NOT
--      contracted for this account, so NO_TRAINING_DEFAULT_RETENTION with
--      supports_zero_retention = false. That class alone justifies
--      INTERNAL; CONFIDENTIAL comes from the owner's decision 62, recorded
--      in owner_approved_ceiling, owner_approval_ref and metadata.
--   3. Two models: claude-sonnet-5-5 (answers, synthesis, comparison,
--      investigation) and claude-haiku-5-5 (the turn reader, fast
--      classification, extraction, taxonomy), each with prices.
--   4. Version-2 routing policies for the seven Q reasoning classes,
--      created RETIRED (staged): Claude first, then OpenAI gpt-5.6-luna,
--      then Groq gpt-oss-120b, then the classes' existing Gemini fallbacks
--      (PUBLIC-only, so they never see a CONFIDENTIAL request). Every other
--      column is copied from the class's active v1 row, except the
--      NORMAL_DIALOGUE cost ceiling (below).
--
-- Nothing routes to Claude until an operator runs the switch: one UPDATE
-- that sets the v2 rows ACTIVE. The gateway takes the highest active
-- version, so v2 then wins and v1 stays in place, untouched, for the
-- rollback, which is the same UPDATE back to RETIRED. Voice, realtime,
-- image, embedding and UI_TRANSLATION routes are untouched.
--
--   switch on:  update ai_ops.routing_policies set status = 'ACTIVE'
--                where code in ('normal_dialogue.v2', 'evidence_synthesis.v2',
--                  'comparison.v2', 'deep_investigation.v2',
--                  'fast_classification.v2', 'structured_extraction.v2',
--                  'taxonomy_mapping.v2');
--   switch off: the same with status = 'RETIRED'.
--   emergency:  update ai_ops.providers set status = 'DISABLED'
--                where code = 'anthropic';   -- Claude skipped, v2 order kept
--
-- The NORMAL_DIALOGUE v2 cost ceiling is 0.25, not v1's 0.10: the gateway
-- estimates an attempt at full input price (no cache credit) plus the
-- whole output budget, and at Sonnet's $2/$10 a 30k-token answer prompt
-- with 4,096 output tokens already estimates at $0.10, so v1's ceiling
-- would quietly send long answers to the fallback. Real spend is lower:
-- the shared prefix is read from cache at a tenth of the price.
--
-- Additive only: no DROP, no grant, no RLS change. ai_ops has no client
-- grants (service_role and postgres only, 20260907090000); the new columns
-- inherit the table-level grants and the RLS-with-no-policy posture.
-- 999_ai_ops_anthropic_claude_reasoning.test.sql covers it.

alter table ai_ops.providers
  add column owner_approved_ceiling text
    constraint providers_owner_approved_ceiling_values
      check (owner_approved_ceiling is null
             or owner_approved_ceiling in ('INTERNAL', 'CONFIDENTIAL')),
  add column owner_approval_ref text
    constraint providers_owner_approval_ref_shape
      check (owner_approval_ref is null
             or owner_approval_ref ~ '^[A-Z][A-Z0-9-]{2,63}$');

alter table ai_ops.providers
  add constraint providers_owner_approval_recorded
    check ((owner_approved_ceiling is null) = (owner_approval_ref is null)),
  add constraint providers_owner_approval_needs_no_training
    check (owner_approved_ceiling is null
           or privacy_policy_class in ('NO_TRAINING_DEFAULT_RETENTION',
                                       'NO_TRAINING_ZERO_RETENTION',
                                       'ENTERPRISE_CONTRACT'));

comment on column ai_ops.providers.owner_approved_ceiling is
  'A sensitivity ceiling the owner approved by recorded decision, above what privacy_policy_class justifies. Never above CONFIDENTIAL; only for a no-training class; requires owner_approval_ref.';
comment on column ai_ops.providers.owner_approval_ref is
  'The recorded decision behind owner_approved_ceiling, e.g. DECISIONS-62 (docs/ai-handoff/DECISIONS.md).';

insert into ai_ops.providers
  (id, code, name, status, region_support, privacy_policy_class,
   supports_zero_retention, supports_byo_key, owner_approved_ceiling,
   owner_approval_ref, metadata)
values
  ('a1000000-0000-4000-8000-000000000004', 'anthropic', 'Anthropic', 'ACTIVE',
   '[]'::jsonb, 'NO_TRAINING_DEFAULT_RETENTION', false, true,
   'CONFIDENTIAL', 'DECISIONS-62',
   jsonb_build_object(
     'review_status', 'OWNER_APPROVED',
     'account_tier', 'paid API key (Claude API, first party)',
     'note', 'Commercial terms: API inputs and outputs are not used for training. Zero data retention is not contracted for this account; the vendor''s standard retention applies, so the privacy class alone justifies INTERNAL.',
     'confidential_eligibility', 'CONFIDENTIAL eligibility is the owner''s governance decision 62 (2026-11-06, docs/ai-handoff/DECISIONS.md): Anthropic approved for CONFIDENTIAL context through the API key route. Not a zero-retention or enterprise-contract claim.',
     'spend_cap', 'Test and evaluation use capped at USD 20 in total (decision 62); hard limit set by the owner in the Anthropic console.',
     'terms_url', 'https://www.anthropic.com/legal/commercial-terms',
     'verified_at', '2026-11-06'));

insert into ai_ops.models
  (id, provider_id, model_code, model_family, model_type, status,
   context_window, max_output_tokens, supports_tools,
   supports_structured_output, supports_vision, supports_audio,
   supports_realtime, supports_prompt_cache, supports_reasoning,
   sensitivity_ceiling, quality_class, latency_class, effective_from, metadata)
values
  ('a2000000-0000-4000-8000-000000000030', 'a1000000-0000-4000-8000-000000000004',
   'claude-sonnet-5-5', 'claude-sonnet', 'TEXT_GENERATION', 'ACTIVE',
   1000000, 128000, true, true, true, false, false, true, true,
   'CONFIDENTIAL', 'HIGH', 'STANDARD', '2026-11-06T00:00:00Z',
   '{"role":"answers, evidence synthesis, comparison, deep investigation","sensitivity_basis":"owner decision 62","source_url":"https://platform.claude.com/docs/en/about-claude/models/overview","verified_at":"2026-11-06"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000031', 'a1000000-0000-4000-8000-000000000004',
   'claude-haiku-5-5', 'claude-haiku', 'TEXT_GENERATION', 'ACTIVE',
   1000000, 128000, true, true, true, false, false, true, true,
   'CONFIDENTIAL', 'STANDARD', 'FAST', '2026-11-06T00:00:00Z',
   '{"role":"turn reader, fast classification, structured extraction, taxonomy mapping","sensitivity_basis":"owner decision 62","pricing_note":"Prices are the rate card for prompts of 100K tokens or fewer; longer prompts bill at 0.50/2.50 per million.","source_url":"https://platform.claude.com/docs/en/about-claude/models/overview","verified_at":"2026-11-06"}'::jsonb);

-- Cached input is the cache-READ rate (0.1x input). Cache writes bill at
-- 1.25x input and are priced by the gateway at the base rate; the receipt
-- records the understatement.
insert into ai_ops.model_prices
  (id, model_id, pricing_region, currency, input_per_million,
   cached_input_per_million, output_per_million, batch_input_per_million,
   batch_output_per_million, effective_from, source_url, verified_at)
values
  ('a3000000-0000-4000-8000-000000000030', 'a2000000-0000-4000-8000-000000000030',
   'global', 'USD', 2.000000, 0.200000, 10.000000, 1.000000, 5.000000,
   '2026-11-06T00:00:00Z', 'https://platform.claude.com/docs/en/about-claude/pricing',
   '2026-11-06T00:00:00Z'),
  ('a3000000-0000-4000-8000-000000000031', 'a2000000-0000-4000-8000-000000000031',
   'global', 'USD', 0.100000, 0.010000, 0.500000, 0.050000, 0.250000,
   '2026-11-06T00:00:00Z', 'https://platform.claude.com/docs/en/about-claude/pricing',
   '2026-11-06T00:00:00Z');

-- Staged v2 policies. Order: Claude -> OpenAI gpt-5.6-luna -> Groq
-- gpt-oss-120b -> the v1 row's Gemini fallbacks (which are PUBLIC-only).
--   ...0030 claude-sonnet-5-5   ...0031 claude-haiku-5-5
--   ...0009 gpt-5.6-luna        ...0004 openai/gpt-oss-120b (groq)
with staged (task_class, claude, ceiling) as (
  values
    ('NORMAL_DIALOGUE',       'a2000000-0000-4000-8000-000000000030'::uuid, 0.25::numeric),
    ('EVIDENCE_SYNTHESIS',    'a2000000-0000-4000-8000-000000000030'::uuid, null),
    ('COMPARISON',            'a2000000-0000-4000-8000-000000000030'::uuid, null),
    ('DEEP_INVESTIGATION',    'a2000000-0000-4000-8000-000000000030'::uuid, null),
    ('FAST_CLASSIFICATION',   'a2000000-0000-4000-8000-000000000031'::uuid, null),
    ('STRUCTURED_EXTRACTION', 'a2000000-0000-4000-8000-000000000031'::uuid, null),
    ('TAXONOMY_MAPPING',      'a2000000-0000-4000-8000-000000000031'::uuid, null)
)
insert into ai_ops.routing_policies
  (code, task_class, sensitivity_class, quality_floor, latency_target_ms,
   hedge_after_ms, reasoning_levels, cost_ceiling_usd, preferred_models,
   fallback_models, allow_free_router, status, version)
select regexp_replace(v1.code, '\.v1$', '.v2'),
       v1.task_class, v1.sensitivity_class, v1.quality_floor,
       v1.latency_target_ms, v1.hedge_after_ms, v1.reasoning_levels,
       coalesce(staged.ceiling, v1.cost_ceiling_usd),
       array[staged.claude],
       array['a2000000-0000-4000-8000-000000000009'::uuid,
             'a2000000-0000-4000-8000-000000000004'::uuid]
         || array(select m from unnest(v1.preferred_models || v1.fallback_models) with ordinality as u(m, n)
                   where m not in ('a2000000-0000-4000-8000-000000000009'::uuid,
                                   'a2000000-0000-4000-8000-000000000004'::uuid)
                   order by n),
       v1.allow_free_router, 'RETIRED', 2
  from staged
  join ai_ops.routing_policies v1
    on v1.task_class = staged.task_class
   and v1.status = 'ACTIVE'
   and v1.version = 1;

do $$
begin
  if (select count(*) from ai_ops.routing_policies where version = 2) <> 7 then
    raise exception 'expected seven staged v2 routing policies';
  end if;
end $$;
