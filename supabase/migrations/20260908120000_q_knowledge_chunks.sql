-- CQ-RAG-001 · q_knowledge: the derived, versioned, provenance-preserving
-- chunk substrate (doc 13 §41.1, doc 14 §11-§14, doc 15 §20-§21).
--
--   source ≠ document ≠ document version ≠ extraction ≠ chunk
--   chunk ≠ evidence item ≠ claim ≠ Q knowledge ≠ canonical company fact
--   parsed text ≠ verified truth;   uploaded document ≠ instruction
--
-- A chunk is a searchable derived representation of governed source
-- content. It never replaces source or evidence truth, it can always be
-- rebuilt from the extraction artifact, and it can never be more visible or
-- less sensitive than what it was derived from. No embedding, no vector, no
-- index of meaning lives here yet: those are later derived layers over the
-- same rows.

create schema if not exists q_knowledge;
comment on schema q_knowledge is
  'Q knowledge bounded context: derived chunks now; embeddings, knowledge objects, memory, contradiction and lineage in later packets. Server-internal; never a browser API.';
revoke all on schema q_knowledge from public;

-- ---------------------------------------------------------------------------
-- Which chunker derived a processing run's chunk set. Provenance only.
-- ---------------------------------------------------------------------------

alter table evidence.document_processing_runs
  add column chunking_version text
    check (chunking_version is null or chunking_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$');

comment on column evidence.document_processing_runs.chunking_version is
  'The chunking strategy version the run derived a chunk set under (CQ-RAG-001). Null when the run produced no chunks.';

-- ---------------------------------------------------------------------------
-- Chunk sets: one derived set per (document version, extraction, chunking
-- version). The set is the unit of lifecycle: a newer chunker or a newer
-- document version supersedes it; a revoked source revokes it. A set is
-- never rewritten in place; history stays readable.
-- ---------------------------------------------------------------------------

create table q_knowledge.chunk_sets (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  owner_organisation_id  uuid not null,
  -- The provenance Source, when one is registered for the document.
  source_id              uuid,
  document_id            uuid not null,
  document_version_id    uuid not null,
  extraction_id          uuid not null references evidence.document_extractions (id) on delete restrict,
  -- Typed subject through the Evidence subject registry; never a table name.
  subject_type           text not null check (subject_type in ('COMPANY')),
  subject_id             uuid not null,
  extractor_id           text not null check (extractor_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  extractor_version      text not null check (length(extractor_version) between 1 and 32),
  chunking_strategy      text not null check (chunking_strategy in ('slide', 'narrative', 'spreadsheet', 'mixed')),
  chunking_version       text not null check (chunking_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  -- Inherited from the extraction, which inherited it from the document.
  visibility_scope       text not null check (visibility_scope in (
                           'personal_private', 'organisation_private', 'founder_private',
                           'investor_private', 'relationship_shared', 'specifically_shared',
                           'network_visible', 'public_external')),
  sensitivity_class      text not null check (sensitivity_class in (
                           'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                           'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  status                 text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  status_reason          text check (status_reason is null or status_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  invalidated_at         timestamptz,
  chunk_count            integer not null check (chunk_count >= 0),
  token_estimate         integer not null check (token_estimate >= 0),
  created_at             timestamptz not null default now(),
  unique (id, tenant_id),
  -- Same version, same parser output, same chunker: one logical set.
  unique (document_version_id, extraction_id, chunking_version),
  check ((status = 'ACTIVE') = (invalidated_at is null)),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict,
  foreign key (source_id, tenant_id)
    references evidence.sources (id, tenant_id) on delete restrict,
  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict
);

comment on table q_knowledge.chunk_sets is
  'One derived chunk set per (document version, extraction, chunking version). The lifecycle unit: superseded by a newer chunker or document version, revoked with its source. Never rewritten; rebuildable from the extraction artifact.';
comment on column q_knowledge.chunk_sets.status is
  'ACTIVE: eligible for future retrieval. SUPERSEDED: a newer set or version replaced it. REVOKED: the source or document was withdrawn. Only ACTIVE sets may ever be retrieval candidates.';

-- At most one ACTIVE set per document: the current version under the
-- current chunker. Reprocessing an old version or an old chunker never
-- competes with it.
create unique index chunk_sets_one_active_per_document_idx
  on q_knowledge.chunk_sets (document_id) where status = 'ACTIVE';
create index chunk_sets_version_idx
  on q_knowledge.chunk_sets (tenant_id, document_version_id, created_at desc);
create index chunk_sets_subject_active_idx
  on q_knowledge.chunk_sets (tenant_id, subject_type, subject_id) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Chunks. Direct tenant ownership, typed subject, exact locator, content
-- hash, inherited visibility and sensitivity, lifecycle. A parent chunk is
-- the coherent section or slide; a leaf is the searchable child. Both live
-- here; retrieval later searches leaves and returns their parents.
-- ---------------------------------------------------------------------------

create table q_knowledge.chunks (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  chunk_set_id              uuid not null,
  document_version_id       uuid not null,
  subject_type              text not null check (subject_type in ('COMPANY')),
  subject_id                uuid not null,
  parent_chunk_id           uuid,
  chunk_index               integer not null check (chunk_index >= 0),
  role                      text not null check (role in ('LEAF', 'PARENT')),
  chunk_kind                text not null check (chunk_kind in (
                              'slide', 'section', 'passage', 'table', 'list', 'spreadsheet_range')),
  -- Derived search material: the only place source text is intentionally
  -- duplicated. Bounded so one chunk is one bounded retrieval unit.
  content                   text not null check (length(content) between 1 and 32000),
  content_sha256            text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- A deterministic, provider-neutral estimate; never a provider's billing count.
  token_estimate            integer not null check (token_estimate >= 0),
  block_index_start         integer not null check (block_index_start >= 0),
  block_index_end           integer not null check (block_index_end >= block_index_start),
  -- Typed provenance (page, slide, heading path, sheet, range, rows). Never authority.
  locator                   jsonb not null check (jsonb_typeof(locator) = 'object' and length(locator::text) <= 2048),
  visibility_scope          text not null check (visibility_scope in (
                              'personal_private', 'organisation_private', 'founder_private',
                              'investor_private', 'relationship_shared', 'specifically_shared',
                              'network_visible', 'public_external')),
  sensitivity_class         text not null check (sensitivity_class in (
                              'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                              'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- Instruction-shaped passages noticed in this chunk's blocks. Risk metadata, never proof.
  instruction_risk_signals  integer not null default 0 check (instruction_risk_signals >= 0),
  status                    text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  invalidated_at            timestamptz,
  created_at                timestamptz not null default now(),
  unique (id, tenant_id),
  unique (id, chunk_set_id),
  unique (chunk_set_id, chunk_index),
  check (parent_chunk_id is null or parent_chunk_id <> id),
  check ((status = 'ACTIVE') = (invalidated_at is null)),
  foreign key (chunk_set_id, tenant_id)
    references q_knowledge.chunk_sets (id, tenant_id) on delete restrict,
  -- A parent is a chunk of the same set: never another document, never another tenant.
  foreign key (parent_chunk_id, chunk_set_id)
    references q_knowledge.chunks (id, chunk_set_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict
);

comment on table q_knowledge.chunks is
  'Structure-aware derived chunks with full provenance. A chunk is searchable material, not evidence, not a claim, not knowledge and never a company fact. It inherits its source''s visibility and sensitivity and can be rebuilt from the extraction artifact at any time.';
comment on column q_knowledge.chunks.locator is
  'Where the text came from: page, slide, heading path, sheet, range, rows. Provenance only; knowing a locator grants no access.';
comment on column q_knowledge.chunks.content_sha256 is
  'Deterministic hash of the content for rebuild comparison and in-set change detection. Equal hashes across tenants never merge ownership or access.';

create index chunks_version_active_idx
  on q_knowledge.chunks (tenant_id, document_version_id, chunk_index) where status = 'ACTIVE';
create index chunks_subject_leaf_active_idx
  on q_knowledge.chunks (tenant_id, subject_type, subject_id) where status = 'ACTIVE' and role = 'LEAF';
create index chunks_parent_idx
  on q_knowledge.chunks (parent_chunk_id) where parent_chunk_id is not null;

-- ---------------------------------------------------------------------------
-- Derived rows change lifecycle, never identity or content. Rebuilding is a
-- new set; correcting is a new chunker version. A non-active set may be
-- purged as rebuildable derived data; an active one may not vanish.
-- ---------------------------------------------------------------------------

create or replace function q_knowledge.protect_chunk_set() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'ACTIVE' then
      raise exception 'an active chunk set cannot be deleted; supersede or revoke it first'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.owner_organisation_id is distinct from old.owner_organisation_id
     or new.source_id is distinct from old.source_id
     or new.document_id is distinct from old.document_id
     or new.document_version_id is distinct from old.document_version_id
     or new.extraction_id is distinct from old.extraction_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.extractor_id is distinct from old.extractor_id
     or new.extractor_version is distinct from old.extractor_version
     or new.chunking_strategy is distinct from old.chunking_strategy
     or new.chunking_version is distinct from old.chunking_version
     or new.visibility_scope is distinct from old.visibility_scope
     or new.sensitivity_class is distinct from old.sensitivity_class
     or new.chunk_count is distinct from old.chunk_count
     or new.token_estimate is distinct from old.token_estimate
     or new.created_at is distinct from old.created_at then
    raise exception 'chunk set identity and provenance are immutable; rebuild under a new chunking version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_knowledge.protect_chunk_set() from public;

create trigger chunk_sets_protect
  before update or delete on q_knowledge.chunk_sets
  for each row execute function q_knowledge.protect_chunk_set();

create or replace function q_knowledge.protect_chunk() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'ACTIVE' then
      raise exception 'an active chunk cannot be deleted; supersede or revoke its set first'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.chunk_set_id is distinct from old.chunk_set_id
     or new.document_version_id is distinct from old.document_version_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.parent_chunk_id is distinct from old.parent_chunk_id
     or new.chunk_index is distinct from old.chunk_index
     or new.role is distinct from old.role
     or new.chunk_kind is distinct from old.chunk_kind
     or new.content is distinct from old.content
     or new.content_sha256 is distinct from old.content_sha256
     or new.token_estimate is distinct from old.token_estimate
     or new.block_index_start is distinct from old.block_index_start
     or new.block_index_end is distinct from old.block_index_end
     or new.locator is distinct from old.locator
     or new.visibility_scope is distinct from old.visibility_scope
     or new.sensitivity_class is distinct from old.sensitivity_class
     or new.instruction_risk_signals is distinct from old.instruction_risk_signals
     or new.created_at is distinct from old.created_at then
    raise exception 'chunk content, provenance and placement are immutable; rebuild under a new chunking version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_knowledge.protect_chunk() from public;

create trigger chunks_protect
  before update or delete on q_knowledge.chunks
  for each row execute function q_knowledge.protect_chunk();

-- Server-only. No policy exists on purpose: the privileged server role reads
-- these rows, and application authorisation (the Context Firewall, the
-- disclosure policy) decides what any person may see. RLS does not replace
-- the firewall; the firewall does not replace RLS.
alter table q_knowledge.chunk_sets enable row level security;
alter table q_knowledge.chunks enable row level security;
