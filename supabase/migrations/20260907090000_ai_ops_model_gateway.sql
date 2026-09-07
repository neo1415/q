-- CQ-Q-005 · ai_ops: the provider/model catalog, versioned price snapshots,
-- versioned routing policies and the append-only model usage ledger the
-- Model Gateway routes and accounts with (doc 13 §56, §120; doc 12 §24,
-- §51; doc 15 §61-62, §129).
--
--   Q                 ≠ model provider
--   task class        ≠ model name
--   available model   ≠ eligible model
--   free              ≠ safe
--   price snapshot    ≠ constant in code
--   model usage       ≠ conversation content
--
-- Operational configuration and accounting only. No prompt, no response,
-- no reasoning and no credential can be stored here: every text column is
-- bounded and vocabulary-checked, the ledger has no content column at all,
-- and a provider row carries a data-use CLASS, never a key. Everything in
-- this schema is INTERNAL_SERVER_ONLY: the browser has no business with
-- prices, routing or another tenant's spend.

create schema if not exists ai_ops;
comment on schema ai_ops is
  'Model Gateway operations: provider and model catalog, versioned price snapshots, versioned routing policies, append-only model usage ledger. Configuration and accounting — never prompts, responses, reasoning or credentials.';

revoke all on schema ai_ops from public, anon, authenticated;
grant usage on schema ai_ops to postgres, service_role;

-- ---------------------------------------------------------------------------
-- ai_ops.providers  (doc 13 §56.1)
--
-- A provider is an endpoint configuration under review, not a company. Its
-- privacy_policy_class is what Capital Q has verified about the data it
-- receives (doc 15 §61); UNREVIEWED is the honest default. Its status is a
-- kill switch (packet §47). Neither field is a credential: keys live in
-- the server environment only.
-- ---------------------------------------------------------------------------

create table ai_ops.providers (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name                     text not null check (length(name) between 1 and 120),
  status                   text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  -- ISO region codes the provider can serve from; '[]' means unspecified.
  region_support           jsonb not null default '[]'::jsonb
                             check (jsonb_typeof(region_support) = 'array' and length(region_support::text) <= 2048),
  privacy_policy_class     text not null default 'UNREVIEWED' check (privacy_policy_class in (
                             'UNREVIEWED', 'TRAINING_PERMITTED', 'NO_TRAINING_DEFAULT_RETENTION',
                             'NO_TRAINING_ZERO_RETENTION', 'ENTERPRISE_CONTRACT')),
  supports_zero_retention  boolean not null default false,
  supports_byo_key         boolean not null default false,
  -- Review notes and source URLs. Bounded; never a credential, never a prompt.
  metadata                 jsonb not null default '{}'::jsonb
                             check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 8192),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table ai_ops.providers is
  'Model providers as reviewed endpoint configurations: status (kill switch) and verified data-use class. Never a credential.';
comment on column ai_ops.providers.privacy_policy_class is
  'What Capital Q has verified about the provider''s training/retention terms for this endpoint. UNREVIEWED by default; eligibility reads the model sensitivity ceiling, which must not exceed what this class justifies.';

-- ---------------------------------------------------------------------------
-- ai_ops.models  (doc 13 §56.2)
--
-- One row per provider model the gateway may route to. The sensitivity
-- ceiling is the policy record (doc 15 §61): the strongest class of data
-- that may be sent to this model under the provider's reviewed terms. It
-- is set by review, never by price and never by nationality.
-- ---------------------------------------------------------------------------

create table ai_ops.models (
  id                          uuid primary key default gen_random_uuid(),
  provider_id                 uuid not null references ai_ops.providers (id) on delete restrict,
  model_code                  text not null check (model_code ~ '^[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$'),
  model_family                text not null check (length(model_family) between 1 and 64),
  model_type                  text not null check (model_type in ('TEXT_GENERATION', 'EMBEDDING', 'REALTIME', 'RERANKING')),
  status                      text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED', 'RETIRED')),
  context_window              integer not null check (context_window > 0),
  max_output_tokens           integer not null check (max_output_tokens > 0),
  supports_tools              boolean not null default false,
  supports_structured_output  boolean not null default false,
  supports_vision             boolean not null default false,
  supports_audio              boolean not null default false,
  supports_realtime           boolean not null default false,
  supports_prompt_cache       boolean not null default false,
  supports_reasoning          boolean not null default false,
  sensitivity_ceiling         text not null check (sensitivity_ceiling in (
                                'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  quality_class               text not null check (quality_class in ('BASIC', 'STANDARD', 'HIGH', 'FRONTIER')),
  latency_class               text not null check (latency_class in ('REALTIME', 'FAST', 'STANDARD', 'SLOW')),
  effective_from              timestamptz not null default now(),
  effective_to                timestamptz check (effective_to is null or effective_to > effective_from),
  metadata                    jsonb not null default '{}'::jsonb
                                check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 8192),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (provider_id, model_code),
  unique (id, provider_id)
);

comment on table ai_ops.models is
  'Model catalog: verified capabilities, context limits, sensitivity ceiling, quality and latency class, effective period. Business code never names a row here; routing policies do.';
comment on column ai_ops.models.sensitivity_ceiling is
  'Strongest sensitivity class that may be sent to this model. A policy decision from provider-terms review — RESTRICTED never enters Q at all.';

-- ---------------------------------------------------------------------------
-- ai_ops.model_prices  (doc 13 §56.3)
--
-- Versioned snapshots. A price change closes the previous period and
-- inserts a new row; historical usage keeps the cost it was priced at.
-- ---------------------------------------------------------------------------

create table ai_ops.model_prices (
  id                        uuid primary key default gen_random_uuid(),
  model_id                  uuid not null references ai_ops.models (id) on delete restrict,
  pricing_region            text not null default 'global' check (pricing_region ~ '^[a-z][a-z0-9_-]{0,31}$'),
  currency                  char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  input_per_million         numeric(12, 6) not null check (input_per_million >= 0),
  cached_input_per_million  numeric(12, 6) check (cached_input_per_million is null or cached_input_per_million >= 0),
  output_per_million        numeric(12, 6) not null check (output_per_million >= 0),
  batch_input_per_million   numeric(12, 6) check (batch_input_per_million is null or batch_input_per_million >= 0),
  batch_output_per_million  numeric(12, 6) check (batch_output_per_million is null or batch_output_per_million >= 0),
  free_tier_description     text check (free_tier_description is null or length(free_tier_description) <= 500),
  effective_from            timestamptz not null,
  effective_to              timestamptz check (effective_to is null or effective_to > effective_from),
  source_url                text not null check (source_url ~ '^https://' and length(source_url) <= 500),
  verified_at               timestamptz not null,
  created_at                timestamptz not null default now(),
  unique (model_id, pricing_region, effective_from)
);

comment on table ai_ops.model_prices is
  'Versioned model price snapshots per region, with source and verification time. Never hardcoded in routing code; a change is a new row, never an update of history.';

-- ---------------------------------------------------------------------------
-- ai_ops.routing_policies  (doc 13 §56.4)
--
-- Data, not code: which models a task class prefers and may fall back to,
-- with the quality floor, latency target and cost ceiling that bound the
-- choice. A policy applies to requests whose sensitivity is at most its
-- sensitivity_class; eligibility is evaluated per candidate before cost
-- ever matters. Versioned: a new version is a new row, and every call is
-- attributable to the code of the row it ran under.
-- ---------------------------------------------------------------------------

create table ai_ops.routing_policies (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[a-z][a-z0-9_]*\.v[0-9]{1,4}$'),
  task_class         text not null check (task_class in (
                       'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION', 'TAXONOMY_MAPPING', 'NORMAL_DIALOGUE',
                       'EVIDENCE_SYNTHESIS', 'COMPARISON', 'DEEP_INVESTIGATION', 'REALTIME_VOICE', 'GUARDRAIL', 'EMBEDDING')),
  sensitivity_class  text not null check (sensitivity_class in (
                       'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  quality_floor      text not null check (quality_floor in ('BASIC', 'STANDARD', 'HIGH', 'FRONTIER')),
  latency_target_ms  integer check (latency_target_ms is null or latency_target_ms > 0),
  cost_ceiling_usd   numeric(12, 6) check (cost_ceiling_usd is null or cost_ceiling_usd > 0),
  preferred_models   uuid[] not null check (cardinality(preferred_models) between 1 and 8),
  fallback_models    uuid[] not null default '{}' check (cardinality(fallback_models) <= 8),
  allow_free_router  boolean not null default false,
  status             text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  version            integer not null check (version > 0),
  created_at         timestamptz not null default now(),
  unique (task_class, sensitivity_class, version)
);

comment on table ai_ops.routing_policies is
  'Versioned, data-driven routing: preferred and fallback model ids per task class and sensitivity class with quality floor, latency target and cost ceiling. Read by the Model Gateway; never by business code.';

-- ---------------------------------------------------------------------------
-- ai_ops.model_usage  (doc 13 §56.5)
--
-- Every real provider attempt — success or failure — with its tokens,
-- latency, cost and failure class. No prompt, no response, no error text.
-- Tenant-owned and append-only: cost attribution is evidence of what
-- happened, and history is never rewritten when prices change.
-- ---------------------------------------------------------------------------

create table ai_ops.model_usage (
  id                    bigserial primary key,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  user_id               uuid references identity.user_profiles (id) on delete restrict,
  q_run_id              uuid,
  task_class            text not null check (task_class in (
                          'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION', 'TAXONOMY_MAPPING', 'NORMAL_DIALOGUE',
                          'EVIDENCE_SYNTHESIS', 'COMPARISON', 'DEEP_INVESTIGATION', 'REALTIME_VOICE', 'GUARDRAIL', 'EMBEDDING')),
  provider_id           uuid not null references ai_ops.providers (id) on delete restrict,
  model_id              uuid not null references ai_ops.models (id) on delete restrict,
  routing_policy_id     uuid references ai_ops.routing_policies (id) on delete restrict,
  attempt               integer not null check (attempt between 1 and 6),
  input_tokens          integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens   integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens         integer not null default 0 check (output_tokens >= 0),
  latency_ms            integer not null check (latency_ms >= 0),
  cost_usd              numeric(14, 8) check (cost_usd is null or cost_usd >= 0),
  cost_basis            text not null check (cost_basis in ('PRICE_SNAPSHOT', 'ESTIMATED', 'UNPRICED')),
  success               boolean not null,
  -- The stable failure class, never a provider's message.
  error_code            text check (error_code is null or error_code in (
                          'TRANSIENT', 'RATE_LIMIT', 'PROVIDER_OUTAGE', 'TIMEOUT', 'INVALID_MODEL_OUTPUT', 'INVALID_REQUEST',
                          'CONTEXT_LIMIT', 'AUTHENTICATION', 'POLICY_INELIGIBLE', 'BUDGET_EXCEEDED', 'CANCELLED', 'PERMANENT')),
  correlation_id        text check (correlation_id is null or length(correlation_id) between 1 and 128),
  occurred_at           timestamptz not null default clock_timestamp(),
  check ((success and error_code is null) or (not success and error_code is not null))
);

create index model_usage_tenant_occurred_idx on ai_ops.model_usage (tenant_id, occurred_at desc);
create index model_usage_run_idx on ai_ops.model_usage (q_run_id) where q_run_id is not null;
create index model_usage_model_occurred_idx on ai_ops.model_usage (model_id, occurred_at desc);

comment on table ai_ops.model_usage is
  'Append-only ledger of every real model attempt: tenant, run, task class, provider, model, tokens, latency, cost with basis, success and failure class. No prompt, no response, no error text, no credential.';

create or replace function ai_ops.model_usage_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_ops.model_usage is append-only'
    using errcode = 'restrict_violation';
end;
$$;

create trigger model_usage_append_only
  before update or delete on ai_ops.model_usage
  for each row execute function ai_ops.model_usage_append_only();

-- ---------------------------------------------------------------------------
-- Protection: INTERNAL_SERVER_ONLY throughout. RLS on as the second layer,
-- no policy for any client role, no grant to anon or authenticated. The
-- server reaches these tables through its own role; a browser session never
-- learns a price, a route, a ceiling or another tenant's spend.
-- ---------------------------------------------------------------------------

alter table ai_ops.providers        enable row level security;
alter table ai_ops.models           enable row level security;
alter table ai_ops.model_prices     enable row level security;
alter table ai_ops.routing_policies enable row level security;
alter table ai_ops.model_usage      enable row level security;

revoke all on all tables in schema ai_ops from public, anon, authenticated;
revoke all on all sequences in schema ai_ops from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema ai_ops to postgres, service_role;
grant usage, select on all sequences in schema ai_ops to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Seed: the two V1 providers, four verified models, price snapshots and
-- routing policy v1. Operational configuration (packet §12-§19), verified
-- against provider documentation on 2026-09-05 — not locked product truth.
-- Fixed ids so the rows are addressable from tests and later migrations.
--
-- Data-use decisions recorded here (doc 15 §61-62; packet §22-§23):
--   google  UNREVIEWED. The Gemini Developer API free tier states that
--           content is used to improve Google products; no paid-tier or
--           enterprise configuration has been reviewed. Ceiling PUBLIC:
--           synthetic and public material only.
--   groq    UNREVIEWED. Provider documentation describes no training and
--           no default retention, but the governing Services Agreement
--           could not be verified from a primary document. Ceiling
--           INTERNAL. Raising either ceiling is a reviewed data change,
--           never a code change, and never inferred from a working key.
-- ---------------------------------------------------------------------------

insert into ai_ops.providers (id, code, name, status, region_support, privacy_policy_class, supports_zero_retention, supports_byo_key, metadata) values
  ('a1000000-0000-4000-8000-000000000001', 'google', 'Google Gemini Developer API', 'ACTIVE', '["global"]'::jsonb,
   'UNREVIEWED', false, true,
   '{"review_status":"UNREVIEWED","account_tier":"unverified","note":"Free-tier terms: content used to improve Google products. Paid-tier treatment differs and is unverified for this account.","terms_url":"https://ai.google.dev/gemini-api/docs/pricing","verified_at":"2026-09-05"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000002', 'groq', 'GroqCloud', 'ACTIVE', '["global"]'::jsonb,
   'UNREVIEWED', false, true,
   '{"review_status":"UNREVIEWED","note":"Documentation describes no training on inference data and no default retention; the Groq Services Agreement was not verified from a primary document.","terms_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05"}'::jsonb);

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.5-flash-lite', 'gemini-3.5', 'TEXT_GENERATION', 'ACTIVE',
   1048576, 65536, true, true, true, true, false, true, true,
   'PUBLIC', 'STANDARD', 'FAST', '2026-09-05T00:00:00Z',
   '{"source_url":"https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite","verified_at":"2026-09-05"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.8-flash', 'gemini-3.8', 'TEXT_GENERATION', 'ACTIVE',
   1048576, 65536, true, true, true, true, false, true, true,
   'PUBLIC', 'HIGH', 'STANDARD', '2026-09-05T00:00:00Z',
   '{"source_url":"https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash","verified_at":"2026-09-05"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'openai/gpt-oss-20b', 'gpt-oss', 'TEXT_GENERATION', 'ACTIVE',
   131072, 65536, true, true, false, false, false, false, true,
   'INTERNAL', 'STANDARD', 'FAST', '2026-09-05T00:00:00Z',
   '{"source_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05","rate_limits":{"tpm":250000,"rpm":1000}}'::jsonb),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'openai/gpt-oss-120b', 'gpt-oss', 'TEXT_GENERATION', 'ACTIVE',
   131072, 65536, true, true, false, false, false, false, true,
   'INTERNAL', 'HIGH', 'FAST', '2026-09-05T00:00:00Z',
   '{"source_url":"https://console.groq.com/docs/models","verified_at":"2026-09-05","rate_limits":{"tpm":250000,"rpm":1000}}'::jsonb);

insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
  batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'global', 'USD', 0.30, 0.03, 2.50, 0.15, 1.25,
   'Free tier available; free-tier content is used to improve Google products.',
   '2026-09-05T00:00:00Z', null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'global', 'USD', 0.75, 0.075, 3.75, 0.375, 1.875,
   'Introductory paid price through 2026-12-31; free tier available with content used to improve Google products.',
   '2026-09-05T00:00:00Z', '2027-01-01T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'global', 'USD', 1.50, 0.15, 7.50, 0.75, 3.75,
   'Announced standard price from 2027-01-01.',
   '2027-01-01T00:00:00Z', null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-09-05T00:00:00Z'),
  ('a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000003', 'global', 'USD', 0.075, null, 0.30, null, null,
   'Developer plan rate limits apply; no free-tier price listed.',
   '2026-09-05T00:00:00Z', null, 'https://console.groq.com/docs/models', '2026-09-05T00:00:00Z'),
  ('a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000004', 'global', 'USD', 0.15, null, 0.60, null, null,
   'Developer plan rate limits apply; no free-tier price listed.',
   '2026-09-05T00:00:00Z', null, 'https://console.groq.com/docs/models', '2026-09-05T00:00:00Z');

-- Routing policy v1 (packet §13): the initial MVP routing hypothesis. Each
-- policy covers every sensitivity up to RESTRICTED; per-candidate
-- eligibility — never the policy — decides what a sensitive request may
-- reach. CQ-Q-010 evals decide model quality; nothing here claims it.
insert into ai_ops.routing_policies (id, code, task_class, sensitivity_class, quality_floor, latency_target_ms, cost_ceiling_usd,
  preferred_models, fallback_models, allow_free_router, status, version) values
  ('a4000000-0000-4000-8000-000000000001', 'fast_classification.v1', 'FAST_CLASSIFICATION', 'RESTRICTED', 'BASIC', 5000, 0.02,
   '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000002', 'structured_extraction.v1', 'STRUCTURED_EXTRACTION', 'RESTRICTED', 'BASIC', 15000, 0.05,
   '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000003', 'taxonomy_mapping.v1', 'TAXONOMY_MAPPING', 'RESTRICTED', 'BASIC', 5000, 0.02,
   '{a2000000-0000-4000-8000-000000000001}', '{a2000000-0000-4000-8000-000000000003}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000004', 'normal_dialogue.v1', 'NORMAL_DIALOGUE', 'RESTRICTED', 'STANDARD', 20000, 0.10,
   '{a2000000-0000-4000-8000-000000000004}', '{a2000000-0000-4000-8000-000000000002}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000005', 'evidence_synthesis.v1', 'EVIDENCE_SYNTHESIS', 'RESTRICTED', 'HIGH', 60000, 0.50,
   '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000006', 'comparison.v1', 'COMPARISON', 'RESTRICTED', 'HIGH', 60000, 0.50,
   '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1),
  ('a4000000-0000-4000-8000-000000000007', 'deep_investigation.v1', 'DEEP_INVESTIGATION', 'RESTRICTED', 'HIGH', 120000, 1.00,
   '{a2000000-0000-4000-8000-000000000002}', '{a2000000-0000-4000-8000-000000000004}', false, 'ACTIVE', 1);
