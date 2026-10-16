-- Lane lang (2026-10-16) · any-language interface by machine translation.
--
-- Owner directive: every language a person can pick just works, with no
-- per-language code. Capital Q's English interface catalogue (the source of
-- truth, packages/q-core/src/ui-text/source.generated.ts) is put into a
-- chosen language once, through the Model Gateway on its own task class,
-- and the result is kept here and shared by everyone who picks that
-- language.
--
--   1. The Model Gateway gains the UI_TRANSLATION task class: its usage
--      rows are recorded like any other model call (the class's own daily
--      spend cap sums them), and one routing policy sends it to the
--      cheapest capable model (gpt-5.6-luna, then gemini-3.5-flash-lite).
--      PUBLIC sensitivity: the material is Capital Q's own product copy,
--      never a person's data.
--   2. q_runtime.ui_translations: one row per (language, catalogue
--      version, English string), keyed by the string's SHA-256 so a row is
--      found from the English alone. Shared, non-tenant reference data,
--      written and read server-side only (RLS on, no policies, browser
--      roles revoked). A translation that failed its checks is kept as
--      REJECTED with no text, so it is not paid for again; the screen shows
--      English for it. Rows are never updated: a new catalogue version is a
--      new row.
--
-- Deploy order: the code that knows UI_TRANSLATION ships BEFORE this is
-- applied (an older catalog loader rejects a routing policy whose task
-- class it does not know).

-- 1. Model Gateway --------------------------------------------------------

alter table ai_ops.model_usage drop constraint model_usage_task_class_check;
alter table ai_ops.model_usage add constraint model_usage_task_class_check
  check (task_class in (
    'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION', 'TAXONOMY_MAPPING',
    'NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON',
    'DEEP_INVESTIGATION', 'REALTIME_VOICE', 'GUARDRAIL', 'EMBEDDING',
    'IMAGE_GENERATION', 'UI_TRANSLATION'));

alter table ai_ops.routing_policies drop constraint routing_policies_task_class_check;
alter table ai_ops.routing_policies add constraint routing_policies_task_class_check
  check (task_class in (
    'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION', 'TAXONOMY_MAPPING',
    'NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON',
    'DEEP_INVESTIGATION', 'REALTIME_VOICE', 'GUARDRAIL', 'EMBEDDING',
    'UI_TRANSLATION'));

insert into ai_ops.routing_policies (id, code, task_class, sensitivity_class, quality_floor, latency_target_ms, cost_ceiling_usd,
  preferred_models, fallback_models, allow_free_router, status, version) values
  ('a4000000-0000-4000-8000-000000000008', 'ui_translation.v1', 'UI_TRANSLATION', 'PUBLIC', 'STANDARD', 60000, 0.05,
   '{a2000000-0000-4000-8000-000000000009}', '{a2000000-0000-4000-8000-000000000001}', false, 'ACTIVE', 1)
on conflict (id) do nothing;

-- 2. The shared translations ----------------------------------------------

create table q_runtime.ui_translations (
  language         text not null
                     check (length(language) <= 35
                            and language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  catalog_version  text not null check (catalog_version ~ '^[a-z][a-z0-9-]*\.v[0-9]{1,4}$'),
  source_hash      text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_text      text not null check (length(source_text) between 1 and 4000),
  status           text not null check (status in ('ACCEPTED', 'REJECTED')),
  translated_text  text check (translated_text is null or length(translated_text) between 1 and 8000),
  -- Why a translation was refused (the check's code), never model text.
  rejection_reason text check (rejection_reason is null or rejection_reason ~ '^[A-Z_]{1,32}$'),
  model_code       text check (model_code is null or length(model_code) between 1 and 128),
  created_at       timestamptz not null default clock_timestamp(),
  primary key (language, catalog_version, source_hash),
  check (source_hash = encode(sha256(convert_to(source_text, 'UTF8')), 'hex')),
  check ((status = 'ACCEPTED') = (translated_text is not null)),
  check ((status = 'REJECTED') = (rejection_reason is not null))
);

comment on table q_runtime.ui_translations is
  'Machine translations of Capital Q''s English interface catalogue, per language and catalogue version; shared, non-tenant, server-only. Hand catalogues win over these at render time.';

alter table q_runtime.ui_translations enable row level security;
revoke all on q_runtime.ui_translations from anon, authenticated;
-- No policies: server-only.
