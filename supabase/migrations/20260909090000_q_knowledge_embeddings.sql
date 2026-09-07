-- CQ-RAG-003 · q_knowledge.embeddings: the versioned, disposable semantic
-- index over the derived chunks (doc 13 §41.2, doc 14 §15, §115, §119-§122,
-- doc 15 §20-§21, doc 16 TM-RAG).
--
--   chunk ≠ embedding ≠ evidence ≠ claim ≠ Q knowledge ≠ canonical fact
--   similarity ≠ relevance truth;   nearest neighbour ≠ authorised neighbour
--   vector presence ≠ permission;   same text ≠ same ownership
--
-- An embedding is a rebuildable index entry, never a source of truth. It can
-- be recomputed, replaced by another model, or dropped entirely without
-- changing one word of what a document says. What it must never do is
-- outlive its chunk's authorisation: eligibility for retrieval is read from
-- the chunk, so a revoked source cannot come back through a vector.

-- ---------------------------------------------------------------------------
-- pgvector, in the extensions schema this repository already uses for
-- extensions. Declared in a migration so a fresh reset and CI reproduce it;
-- never a dashboard click.
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Embeddings.
--
-- One row is one chunk embedded under one embedding configuration. Several
-- configurations may embed the same chunk at once — that is what makes a
-- model migration a backfill rather than a rewrite — so the unique key is the
-- work identity, never the chunk alone.
--
-- The embedding identity is recorded on the row rather than pointing at
-- ai_ops.models. ai_ops is the Model Gateway's catalogue of generation
-- models: it carries pricing, routing policies, eligibility, context windows
-- and a NOT NULL max_output_tokens, none of which mean anything for a local
-- embedding runtime, and the gateway loads that catalogue for routing. A
-- durable, self-describing identity here keeps historical rows attributable
-- without inventing generation facts or putting an embedding model into the
-- routing catalogue.
-- ---------------------------------------------------------------------------

create table q_knowledge.embeddings (
  id                    uuid primary key default gen_random_uuid(),
  -- Direct ownership, and provably the chunk's own tenant: the composite
  -- foreign key below makes a disagreeing tenant impossible to insert. It is
  -- direct because every semantic query filters by tenant on the same table
  -- it orders by distance; reaching tenancy through a join is exactly how a
  -- security predicate ends up applied after an index scan instead of before.
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  chunk_id              uuid not null,
  -- Which runtime and which weights produced this vector.
  provider_code         text not null check (provider_code ~ '^[a-z][a-z0-9-]{0,31}$'),
  model_code            text not null check (length(model_code) between 1 and 128),
  -- The model repository commit, where the runtime can report one.
  model_revision        text check (model_revision is null or model_revision ~ '^[0-9a-f]{40}$'),
  -- The versioned bundle of provider, model, revision, dimension,
  -- normalisation and instruction strategy. Two configuration versions are
  -- different vector spaces and are never compared.
  configuration_version text not null check (configuration_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  -- Document embeddings carry the canonical "no instruction" marker; a query
  -- instruction belongs to a query, which is never stored here.
  instruction_version   text not null check (instruction_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  embedding_dimension   integer not null check (embedding_dimension between 1 and 4096),
  -- Native pgvector storage, never json, an array or text. 1024 is this
  -- store's physical dimension because PostgreSQL must know it; a model with
  -- another dimension needs its own store, not a looser column here.
  embedding             extensions.vector(1024) not null,
  created_at            timestamptz not null default now(),
  -- The recorded dimension is the vector's actual dimension, checked rather
  -- than trusted, so metadata and payload can never drift apart.
  constraint embeddings_dimension_matches_vector
    check (embedding_dimension = extensions.vector_dims(embedding)),
  -- The work identity (doc 14 §14): this chunk's immutable content, under
  -- this model, dimension, configuration and instruction, is one unit of
  -- work. A retried worker collides here instead of writing a second vector.
  constraint embeddings_work_identity_key
    unique (chunk_id, model_code, embedding_dimension, configuration_version, instruction_version),
  -- Ownership cannot disagree with the chunk's, and a vector cannot exist
  -- without the chunk it encodes. ON DELETE CASCADE is deliberate rather
  -- than reflexive: the chunk is the provenance, CQ-RAG-001 already allows a
  -- superseded chunk to be purged as rebuildable derived data, and an
  -- embedding of a chunk that no longer exists would be an orphan vector
  -- with nothing to attribute it to.
  foreign key (chunk_id, tenant_id)
    references q_knowledge.chunks (id, tenant_id) on delete cascade
);

comment on table q_knowledge.embeddings is
  'Derived semantic index over q_knowledge.chunks. Disposable and rebuildable: never evidence, never a claim, never knowledge, never a company fact. Retrieval eligibility is read from the chunk, so a revoked source cannot return through a vector. Server-internal; raw vectors never reach a browser.';
comment on column q_knowledge.embeddings.tenant_id is
  'Direct ownership, constrained to equal the chunk''s tenant by composite foreign key, so a tenant predicate can be applied on the same table the vector search orders by.';
comment on column q_knowledge.embeddings.configuration_version is
  'The embedding configuration that produced this vector. Vectors from two configuration versions occupy different spaces and are never compared or mixed in one search.';
comment on column q_knowledge.embeddings.embedding is
  'Derived sensitive data. A vector encodes information about private text and inherits the chunk''s tenant, visibility and sensitivity; it is not public because it is numeric.';

-- Search prefilter: every semantic query is scoped to one tenant and one
-- configuration before any distance is computed.
create index embeddings_tenant_configuration_idx
  on q_knowledge.embeddings (tenant_id, configuration_version);

-- No vector index yet. At the volumes this store holds today an exact scan
-- is both correct and fast, and an approximate index under highly selective
-- security filters is a recall problem that must never be answered by
-- loosening the filters. See docs/modules/q-knowledge.md; CQ-RAG-004 revisits
-- this with measurements from real retrieval.

-- ---------------------------------------------------------------------------
-- A vector is written once. Correcting one means embedding again under a new
-- configuration, not editing a row: an updated vector would silently change
-- what past retrieval meant. Deletion stays available because embeddings are
-- rebuildable and because purging a chunk must be able to take them with it.
-- ---------------------------------------------------------------------------

create or replace function q_knowledge.protect_embedding() returns trigger
language plpgsql as $$
begin
  raise exception 'embeddings are immutable; re-embed under a new configuration version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_knowledge.protect_embedding() from public;

create trigger embeddings_immutable
  before update on q_knowledge.embeddings
  for each row execute function q_knowledge.protect_embedding();

-- Server-only, like every other q_knowledge table: RLS on, no policy, no
-- browser grant. A person never queries vectors; the application decides
-- what may be retrieved long before a distance is computed, and RLS is the
-- second layer under that decision rather than a substitute for it.
alter table q_knowledge.embeddings enable row level security;
