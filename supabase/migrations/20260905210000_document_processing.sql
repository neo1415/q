-- CQ-EVD-003 · Document processing pipeline: the work queue, the states a
-- run can honestly report, and where structured extraction is recorded
-- (doc 14 §9–10, doc 15 §25–30, doc 21 §37–43).
--
--   uploaded ≠ safe ≠ parsed ≠ trusted
--   extracted block ≠ evidence item ≠ claim ≠ Q knowledge
--   document text ≠ instruction
--
-- Nothing here parses, scans, embeds or concludes. It records what a
-- processing attempt did and where its output went, so a later reader can
-- ask which file version, which parser and which run produced a passage.

-- ---------------------------------------------------------------------------
-- The documents work queue.
--
-- One shared queue for document work, not one per format: type-specific
-- behaviour lives behind parser adapters (doc 21 §39). Durable, because a
-- lost job means a document silently never processes.
-- ---------------------------------------------------------------------------

select pgmq.create('documents');

-- Attempts that exhausted their retries land here rather than cycling
-- forever. It carries identifiers and a bounded error code; never content.
select pgmq.create('documents-dead');

-- pgmq grants EXECUTE to PUBLIC by default; queues are server infrastructure
-- reached through the worker's own connection.
revoke all on all functions in schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- States a run and a version can truthfully report.
--
-- BLOCKED is policy refusing the work — an infected object, an unavailable
-- scanner under a fail-closed policy, a format with no extractor. It is
-- deliberately not FAILED, which means the attempt broke and another may
-- succeed. UNSUPPORTED says a format has no extractor yet; calling it
-- COMPLETED would be a lie about what the system knows.
-- ---------------------------------------------------------------------------

alter table evidence.document_processing_runs
  drop constraint document_processing_runs_status_check;
alter table evidence.document_processing_runs
  add constraint document_processing_runs_status_check
  check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'));

alter table evidence.document_processing_runs
  drop constraint document_processing_runs_check1;
alter table evidence.document_processing_runs
  add constraint document_processing_runs_error_state_check
  check (error_code is null or status in ('FAILED', 'BLOCKED'));

alter table evidence.document_versions
  drop constraint document_versions_text_extraction_status_check;
alter table evidence.document_versions
  add constraint document_versions_text_extraction_status_check
  check (text_extraction_status in (
    'NOT_STARTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNSUPPORTED'));

comment on column evidence.document_processing_runs.status is
  'QUEUED, RUNNING, COMPLETED, FAILED (the attempt broke) or BLOCKED (policy refused: infected, unscannable, or no extractor). BLOCKED is terminal.';

-- ---------------------------------------------------------------------------
-- The private bucket derived extraction artifacts live in.
--
-- Separate from the raw upload bucket so the two have distinct lifecycles:
-- one holds bytes a stranger sent, the other holds what our own parser made
-- of them. Both are private; neither is browser-writable or publicly
-- readable, and `storage.objects` keeps RLS with no policy for either.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cq-extractions-private',
  'cq-extractions-private',
  false,
  8388608,
  array['application/json']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Structured extraction provenance.
--
-- The blocks themselves are private derived content and live in the bucket
-- above; this table records what was produced, by which parser, from which
-- run, and where it is. One artifact per (version, pipeline version): a
-- different pipeline produces another artifact and never overwrites the
-- first, because processing history is not something to rewrite.
-- ---------------------------------------------------------------------------

create table evidence.document_extractions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,
  owner_organisation_id    uuid not null,
  document_id              uuid not null,
  document_version_id      uuid not null,
  processing_run_id        uuid not null references evidence.document_processing_runs (id) on delete restrict,
  -- The provenance Source, once a later packet registers one per document.
  source_id                uuid,
  schema_version           integer not null check (schema_version >= 1),
  extractor_id             text not null check (extractor_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  extractor_version        text not null check (length(extractor_version) between 1 and 32),
  pipeline_version         text not null check (pipeline_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  artifact_bucket          text not null check (artifact_bucket ~ '^[a-z][a-z0-9-]{1,62}$'),
  -- Server-generated. Never derived from the document's name or title.
  artifact_key             text not null check (artifact_key ~ '^[a-z0-9][a-z0-9/_.-]{0,254}$' and position('..' in artifact_key) = 0),
  artifact_sha256          text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_bytes           bigint not null check (artifact_bytes between 1 and 8388608),
  block_count              integer not null check (block_count >= 0),
  page_count               integer check (page_count is null or page_count >= 0),
  slide_count             integer check (slide_count is null or slide_count >= 0),
  language                 text check (language is null or language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),
  -- Inherited from the document. A parser running is not a reason for
  -- private material to become less private.
  visibility_scope         text not null check (visibility_scope in (
                             'personal_private', 'organisation_private', 'founder_private',
                             'investor_private', 'relationship_shared', 'specifically_shared',
                             'network_visible', 'public_external')),
  sensitivity_class        text not null check (sensitivity_class in (
                             'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                             'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- How many instruction-shaped passages were noticed. Never their text.
  instruction_risk_signals integer not null default 0 check (instruction_risk_signals >= 0),
  created_at               timestamptz not null default now(),
  unique (document_version_id, pipeline_version),
  unique (artifact_bucket, artifact_key),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict,
  foreign key (source_id, tenant_id)
    references evidence.sources (id, tenant_id) on delete restrict,
  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict
);

comment on table evidence.document_extractions is
  'Structured extraction provenance: which parser produced which artifact from which run. Governed source content, never Q knowledge, never a RAG chunk, never a claim. The extracted blocks live in private storage, not in this row.';
comment on column evidence.document_extractions.instruction_risk_signals is
  'Count of instruction-shaped passages a deterministic scanner noticed. A signal for later Q ingestion; document text carries no authority regardless.';

create index document_extractions_version_idx
  on evidence.document_extractions (document_version_id, created_at desc);
create index document_extractions_document_idx
  on evidence.document_extractions (tenant_id, document_id);

-- An extraction is the immutable output of one run. Correcting it means a
-- new pipeline version and a new artifact, never a rewrite of history.
create or replace function evidence.extractions_are_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'document extractions are immutable; reprocess under a new pipeline version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function evidence.extractions_are_immutable() from public;

create trigger document_extractions_immutable
  before update or delete on evidence.document_extractions
  for each row execute function evidence.extractions_are_immutable();

alter table evidence.document_extractions enable row level security;
