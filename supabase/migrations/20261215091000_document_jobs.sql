-- Q room W5 (R8) · documents made by a job, and the person's own pictures.
--
--   1. artifacts.document_jobs: one job per document Q is making (a deck,
--      a one-pager, a memo). The Q run writes the first draft from the
--      person's record and queues the job; the worker designs it, finds
--      its pictures, checks it (at most two fix rounds) and files the
--      first version. The stage is what the room and the silence ladder
--      say while it runs. Server-only: no browser principal reads or
--      writes a job; the Q API reads progress as the person.
--   2. artifacts.document_images also holds the person's own picture,
--      dropped on a placeholder (OWN_UPLOAD): a server-side copy of their
--      upload, served like a generated image (signed URL, owner only).
--      Budgets count generated images only.

-- 1. Jobs --------------------------------------------------------------------

create table artifacts.document_jobs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  organisation_id       uuid not null,
  artifact_id           uuid not null unique references artifacts.artifacts (id) on delete restrict,
  requested_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  -- The run that asked: generated-image budgets count per run.
  q_run_id              uuid not null,
  kind                  text not null check (kind in ('PITCH_DECK', 'ONE_PAGER', 'MEMO')),
  stage                 text not null default 'QUEUED' check (stage in (
                          'QUEUED', 'WRITING', 'DESIGNING', 'FINDING_ASSETS',
                          'CHECKING', 'FIXING', 'READY', 'FAILED')),
  status                text not null default 'QUEUED'
                          check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  attempts              integer not null default 0 check (attempts between 0 and 3),
  -- The writer's draft and what the run resolved as the person (grounding
  -- statements, sector codes, the confirmed brand kit). Never model
  -- output beyond the composed draft; bounded.
  input                 jsonb not null check (pg_column_size(input) <= 1048576),
  failure_code          text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{2,47}$'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  constraint document_jobs_finished
    check ((status in ('DONE', 'FAILED')) = (finished_at is not null))
);

comment on table artifacts.document_jobs is
  'A document Q is making for a person (Q room W5): the first draft from their record, queued for the worker that designs, illustrates and checks it. Server-only; progress is read through the Q API as the person.';

-- The worker claims the oldest waiting job (for update skip locked).
create index document_jobs_waiting_idx
  on artifacts.document_jobs (created_at)
  where status in ('QUEUED', 'RUNNING');
create index document_jobs_owner_idx
  on artifacts.document_jobs (tenant_id, organisation_id, requested_by_user_id, created_at desc);

alter table artifacts.document_jobs enable row level security;
revoke all on artifacts.document_jobs from anon, authenticated;

-- 2. The person's own pictures ------------------------------------------------

alter table artifacts.document_images
  drop constraint document_images_provenance_check;
alter table artifacts.document_images
  add constraint document_images_provenance_check
  check (provenance in ('AI_GENERATED', 'OWN_UPLOAD'));

alter table artifacts.document_images
  drop constraint document_images_purpose_check;
alter table artifacts.document_images
  add constraint document_images_purpose_check
  check (purpose in ('COVER', 'SLIDE', 'UPLOAD'));

-- Where an own picture came from: their document, in their data room.
alter table artifacts.document_images
  add column source_document_id uuid references evidence.documents (id) on delete restrict;
alter table artifacts.document_images
  add constraint document_images_upload_source
  check ((provenance = 'OWN_UPLOAD') = (source_document_id is not null));
