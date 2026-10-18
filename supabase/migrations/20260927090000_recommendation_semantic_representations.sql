-- CQ-REC-003 · recommendation: purpose-approved semantic representations and
-- the vectors derived from them (doc 19 §24-§26, §117; doc 13 §41.2; doc 14
-- §15; doc 15 §20-§21).
--
--   representation ≠ canonical company truth ≠ Q knowledge ≠ evidence
--   similarity ≠ fit ≠ match ≠ quality ≠ recommendation
--   vector presence ≠ discoverability;   stale vector ≠ current permission
--
-- A representation is a deterministic, versioned textual projection of the
-- fields an investor may already see about a discoverable company (or of an
-- investor's own ACTIVE mandate, for that investor's own recommendation
-- context). It is derived recommendation infrastructure: rebuildable from
-- canonical rows, never a second source of company truth, never edited in
-- place. Its embedding is a disposable index entry under one embedding
-- configuration. Neither may be read by a browser principal.
--
-- Why not q_knowledge.embeddings: that store indexes Q's private chunks and
-- keys every vector to a chunk of a document. A recommendation
-- representation is not a chunk, is not evidence, and is built from a
-- different (investor-visible) layer; putting it there would make Q's
-- private index the home of a marketplace projection.

create schema if not exists recommendation;
comment on schema recommendation is
  'Recommendation bounded context (doc 19): derived, rebuildable retrieval infrastructure — semantic representations and their vectors. Server-internal; never a browser API; never canonical company or investor truth.';
revoke all on schema recommendation from public;

-- ---------------------------------------------------------------------------
-- Company investment representations (doc 19 §25).
--
-- One CURRENT row per company, purpose and representation version. A rebuild
-- that produces the same content keeps the row; a rebuild that produces
-- different content supersedes it and inserts a new one, so history stays
-- attributable and a vector always points at the exact text it encoded.
-- ---------------------------------------------------------------------------

create table recommendation.company_representations (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  company_id              uuid not null,
  -- The only purpose in V1. A future purpose is a new value, never a reuse.
  purpose                 text not null check (purpose = 'INVESTOR_DISCOVER'),
  -- company-investment-representation.v1: field selection and normalisation.
  representation_version  text not null check (representation_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  -- sha256 over the canonical inputs (ids, versions, codes), so staleness is
  -- detected without rebuilding the text.
  source_fingerprint      text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  -- sha256 of `content`; the embedding work identity starts here.
  content_sha256          text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- The projection text itself. Investor-visible fields only, by construction
  -- of the builder; bounded below the embedding runtime's input ceiling.
  content                 text not null check (length(content) between 1 and 4000),
  status                  text not null default 'CURRENT' check (status in ('CURRENT', 'SUPERSEDED')),
  built_at                timestamptz not null default now(),
  superseded_at           timestamptz,
  constraint company_representations_status_matches_supersession
    check ((status = 'CURRENT') = (superseded_at is null)),
  unique (id, tenant_id),
  -- Ownership is the company's, provably.
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete cascade
);

comment on table recommendation.company_representations is
  'Deterministic, versioned investor-visible projection of a discoverable company for INVESTOR_DISCOVER semantic retrieval. Derived and rebuildable; never company truth; never Q knowledge. Server-internal.';
comment on column recommendation.company_representations.content is
  'Investor-visible fields only (name, short description, stage, headquarters, canonical taxonomy). No founder-private memory, conversation, document, evidence or research can reach this column: the builder has no port to them.';

create unique index company_representations_current_key
  on recommendation.company_representations (company_id, purpose, representation_version)
  where status = 'CURRENT';
create index company_representations_company_idx
  on recommendation.company_representations (tenant_id, company_id);

-- ---------------------------------------------------------------------------
-- Investor mandate representations (doc 19 §26).
--
-- Private to the investor organisation's own recommendation context. The
-- content may draw on the investor's declared narrative and preferences; it
-- is never served to a founder and is never joined into a founder-facing
-- projection.
-- ---------------------------------------------------------------------------

create table recommendation.mandate_representations (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null,
  mandate_id                uuid not null,
  -- The mandate row version the content was built from.
  mandate_version           integer not null check (mandate_version >= 1),
  purpose                   text not null check (purpose = 'INVESTOR_DISCOVER'),
  representation_version    text not null check (representation_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  source_fingerprint        text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  content_sha256            text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content                   text not null check (length(content) between 1 and 4000),
  status                    text not null default 'CURRENT' check (status in ('CURRENT', 'SUPERSEDED')),
  built_at                  timestamptz not null default now(),
  superseded_at             timestamptz,
  constraint mandate_representations_status_matches_supersession
    check ((status = 'CURRENT') = (superseded_at is null)),
  unique (id, tenant_id),
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete cascade,
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete cascade
);

comment on table recommendation.mandate_representations is
  'Deterministic, versioned semantic representation of one investor mandate for that investor''s own INVESTOR_DISCOVER retrieval. Investor-private: never exposed to founders, never used for founder discovery. Derived and rebuildable.';

create unique index mandate_representations_current_key
  on recommendation.mandate_representations (mandate_id, purpose, representation_version)
  where status = 'CURRENT';
create index mandate_representations_investor_idx
  on recommendation.mandate_representations (tenant_id, investor_organisation_id, mandate_id);

-- ---------------------------------------------------------------------------
-- Embeddings. One row is one representation embedded under one embedding
-- configuration and instruction version. The work identity is the row's
-- unique key, so a retried refresh collides instead of writing twice.
-- Vectors are immutable: re-embedding is a new configuration version.
-- ---------------------------------------------------------------------------

create table recommendation.company_embeddings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  representation_id     uuid not null,
  -- Denormalised so the nearest-neighbour query can join current
  -- discoverability on the same row it orders by distance.
  company_id            uuid not null,
  provider_code         text not null check (provider_code ~ '^[a-z][a-z0-9-]{0,31}$'),
  model_code            text not null check (length(model_code) between 1 and 128),
  model_revision        text check (model_revision is null or model_revision ~ '^[0-9a-f]{40}$'),
  configuration_version text not null check (configuration_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  -- Documents carry the canonical "no instruction" marker (none-v1).
  instruction_version   text not null check (instruction_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  embedding_dimension   integer not null check (embedding_dimension between 1 and 4096),
  embedding             extensions.vector(1024) not null,
  -- The content hash of the representation this vector encodes: the
  -- application-level cache key that lets an unchanged representation reuse
  -- its vector instead of embedding again.
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at            timestamptz not null default now(),
  constraint company_embeddings_dimension_matches_vector
    check (embedding_dimension = extensions.vector_dims(embedding)),
  constraint company_embeddings_work_identity_key
    unique (representation_id, model_code, embedding_dimension, configuration_version, instruction_version),
  foreign key (representation_id, tenant_id)
    references recommendation.company_representations (id, tenant_id) on delete cascade,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete cascade
);

comment on table recommendation.company_embeddings is
  'Disposable semantic index over recommendation.company_representations. Retrieval eligibility is read from the representation''s status and the company''s current discoverability, then decided by REC-001; a stale vector cannot outrank a current privacy or readiness change. Server-internal; raw vectors never reach a browser.';

-- Search prefilter: every semantic query is scoped to one configuration and
-- instruction version before any distance is computed.
create index company_embeddings_configuration_idx
  on recommendation.company_embeddings (configuration_version, instruction_version);
create index company_embeddings_company_idx
  on recommendation.company_embeddings (tenant_id, company_id);

-- No approximate vector index. This store holds one vector per discoverable
-- company; at that volume an exact scan under the configuration prefilter is
-- both correct and fast, and an HNSW/IVFFlat index under selective security
-- predicates is a recall problem that must never be answered by loosening
-- the predicates (the q_knowledge store follows the same rule). Revisit with
-- measured retrieval when the discoverable population grows.

create table recommendation.mandate_embeddings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  representation_id     uuid not null,
  investor_organisation_id uuid not null,
  provider_code         text not null check (provider_code ~ '^[a-z][a-z0-9-]{0,31}$'),
  model_code            text not null check (length(model_code) between 1 and 128),
  model_revision        text check (model_revision is null or model_revision ~ '^[0-9a-f]{40}$'),
  configuration_version text not null check (configuration_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  -- A mandate is the query side: embedded under the versioned matching
  -- instruction, never as a document.
  instruction_version   text not null check (instruction_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  embedding_dimension   integer not null check (embedding_dimension between 1 and 4096),
  embedding             extensions.vector(1024) not null,
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at            timestamptz not null default now(),
  constraint mandate_embeddings_dimension_matches_vector
    check (embedding_dimension = extensions.vector_dims(embedding)),
  constraint mandate_embeddings_work_identity_key
    unique (representation_id, model_code, embedding_dimension, configuration_version, instruction_version),
  foreign key (representation_id, tenant_id)
    references recommendation.mandate_representations (id, tenant_id) on delete cascade,
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete cascade
);

comment on table recommendation.mandate_embeddings is
  'Query-side vector of one investor mandate representation, kept so an unchanged mandate is not re-embedded on every run. Investor-private; never compared against founder queries; never a stored row of any founder-facing projection.';

create index mandate_embeddings_investor_idx
  on recommendation.mandate_embeddings (tenant_id, investor_organisation_id);

-- ---------------------------------------------------------------------------
-- Immutability. A vector or a representation's content is written once;
-- correcting either means a new row under a new version, so a stored
-- vector always encodes exactly the text on its representation row.
-- Superseding a representation (status + superseded_at) is the one allowed
-- update. Deletion stays available: everything here is rebuildable.
-- ---------------------------------------------------------------------------

create or replace function recommendation.protect_embedding() returns trigger
language plpgsql as $$
begin
  raise exception 'recommendation embeddings are immutable; re-embed under a new configuration version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function recommendation.protect_embedding() from public;

create trigger company_embeddings_immutable
  before update on recommendation.company_embeddings
  for each row execute function recommendation.protect_embedding();
create trigger mandate_embeddings_immutable
  before update on recommendation.mandate_embeddings
  for each row execute function recommendation.protect_embedding();

create or replace function recommendation.protect_representation() returns trigger
language plpgsql as $$
begin
  if new.content is distinct from old.content
     or new.content_sha256 is distinct from old.content_sha256
     or new.source_fingerprint is distinct from old.source_fingerprint
     or new.representation_version is distinct from old.representation_version
     or new.purpose is distinct from old.purpose
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'a representation''s content and identity are immutable; supersede it and build a new one'
      using errcode = 'check_violation';
  end if;
  if old.status = 'SUPERSEDED' and new.status = 'CURRENT' then
    raise exception 'a superseded representation never becomes current again'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function recommendation.protect_representation() from public;

create trigger company_representations_immutable_content
  before update on recommendation.company_representations
  for each row execute function recommendation.protect_representation();
create trigger mandate_representations_immutable_content
  before update on recommendation.mandate_representations
  for each row execute function recommendation.protect_representation();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant. The application decides
-- what may be retrieved before a distance is computed; RLS is the second
-- layer under that decision, never a substitute for it.
-- ---------------------------------------------------------------------------

alter table recommendation.company_representations enable row level security;
alter table recommendation.mandate_representations enable row level security;
alter table recommendation.company_embeddings enable row level security;
alter table recommendation.mandate_embeddings enable row level security;
