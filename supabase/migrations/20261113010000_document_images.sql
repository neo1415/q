-- DOCS · AI-generated images for documents (founder-approved 2026-10-01;
-- ADR 0031 addendum).
--
--   1. The Model Gateway gains an IMAGE_GENERATION task class: usage rows
--      for it are recorded like any other model call, and the catalog
--      names the two image models the adapters may run.
--   2. artifacts.document_images: every generated image's provenance
--      ("AI-generated image", provider, model, the exact prompt, cost),
--      owner-scoped, append-only, server-only. Daily and per-document
--      budgets are counted from it.
--   3. A private storage bucket for the bytes. Delivery is by short-lived
--      signed URL straight from storage to the browser, never through the
--      web app; file exports read the bytes server-side.

-- 1. Model Gateway --------------------------------------------------------

alter table ai_ops.model_usage drop constraint model_usage_task_class_check;
alter table ai_ops.model_usage add constraint model_usage_task_class_check
  check (task_class in (
    'FAST_CLASSIFICATION', 'STRUCTURED_EXTRACTION', 'TAXONOMY_MAPPING',
    'NORMAL_DIALOGUE', 'EVIDENCE_SYNTHESIS', 'COMPARISON',
    'DEEP_INVESTIGATION', 'REALTIME_VOICE', 'GUARDRAIL', 'EMBEDDING',
    'IMAGE_GENERATION'));

alter table ai_ops.models drop constraint models_model_type_check;
alter table ai_ops.models add constraint models_model_type_check
  check (model_type in (
    'TEXT_GENERATION', 'EMBEDDING', 'REALTIME', 'RERANKING',
    'IMAGE_GENERATION'));

insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
  supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
  sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
  ('a2000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000003', 'gpt-image-1', 'gpt-image', 'IMAGE_GENERATION', 'ACTIVE',
   32000, 1, false, false, false, false, false, false, false,
   'INTERNAL', 'STANDARD', 'SLOW', '2026-10-01T00:00:00Z',
   '{"purpose":"document illustrations","note":"Prompts carry only a slide title, the deck''s one-line description and brand colours; never figures, names or people.","verified_at":"2026-10-01"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000001', 'gemini-2.5-flash-image', 'gemini-image', 'IMAGE_GENERATION', 'ACTIVE',
   32000, 1, false, false, false, false, false, false, false,
   'PUBLIC', 'STANDARD', 'SLOW', '2026-10-01T00:00:00Z',
   '{"purpose":"document illustrations (fallback)","note":"Free-tier terms may allow training on prompts; prompts carry nothing beyond what a public deck shows.","verified_at":"2026-10-01"}'::jsonb)
on conflict (id) do nothing;

-- 2. Provenance -------------------------------------------------------------

create table artifacts.document_images (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid not null,
  q_run_id            uuid,
  storage_key         text not null unique
                        check (storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg)$'),
  content_type        text not null check (content_type in ('image/png', 'image/jpeg')),
  byte_size           integer not null check (byte_size between 8 and 5242880),
  provenance          text not null default 'AI_GENERATED' check (provenance = 'AI_GENERATED'),
  provider_code       text not null check (provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  model_code          text not null check (length(model_code) between 1 and 80),
  prompt              text not null check (length(btrim(prompt)) between 1 and 1500),
  purpose             text not null check (purpose in ('COVER', 'SLIDE')),
  cost_usd            numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table artifacts.document_images is
  'AI-generated images Q made for an organisation''s documents: where the bytes are (private bucket), that they are AI-generated, which provider and model, the exact prompt and the cost. Never a photo of anybody, never a logo, never evidence.';

create index document_images_daily_idx
  on artifacts.document_images (tenant_id, organisation_id, created_at desc);
create index document_images_run_idx
  on artifacts.document_images (q_run_id) where q_run_id is not null;
create index document_images_platform_daily_idx
  on artifacts.document_images (created_at desc);

create or replace function artifacts.document_images_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'artifacts.document_images is append-only'
    using errcode = '55000';
end;
$$;

create trigger document_images_append_only
  before update or delete on artifacts.document_images
  for each row execute function artifacts.document_images_append_only();

alter table artifacts.document_images enable row level security;
revoke all on artifacts.document_images from anon, authenticated;
revoke all on function artifacts.document_images_append_only() from public, anon, authenticated;

-- 3. Private bucket -----------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cq-document-images',
  'cq-document-images',
  false,
  5242880,
  array['image/png', 'image/jpeg']
)
on conflict (id) do nothing;
