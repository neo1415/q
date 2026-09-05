-- CQ-EVD-001 · Evidence foundation: sources, documents, immutable document
-- versions, processing provenance, claims with append-only revisions,
-- evidence items and claim-evidence links (doc 13 §19–23; ADR-001 Decision 2
-- for the truth / evidence / lifecycle axes; doc 15 §20–21 for sensitivity).
--
--   Source ≠ Document ≠ DocumentVersion ≠ EvidenceItem ≠ Claim
--   Claim ≠ canonical Company state ≠ Q Knowledge object
--   Evidence ≠ Verification;   same bytes ≠ same authorization
--
-- Nothing here uploads, parses, scans, embeds or infers. Every table is
-- server-internal: RLS enabled, zero policies, zero browser grants. The
-- privileged server role can read every row; that is physical access, never
-- business authorisation.
--
-- Doc 13 §22.1's `verification_state` / `truth_state` are superseded by
-- ADR-001 and deliberately do not exist here.

create schema if not exists evidence;
comment on schema evidence is
  'Evidence bounded context: provenance, documents, immutable file versions, claims and evidence items. Never canonical company truth, never Q knowledge. Server-internal.';
revoke all on schema evidence from public;

-- ---------------------------------------------------------------------------
-- Sources: where information originated. Provenance, never belief.
-- ---------------------------------------------------------------------------

create table evidence.sources (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  source_type         text not null check (source_type in (
                        'USER_STATEMENT', 'DOCUMENT', 'MEETING', 'CONVERSATION', 'PLATFORM_EVENT',
                        'INTEGRATION', 'PUBLIC_WEB', 'REGULATORY_RECORD', 'ADMIN_VERIFICATION')),
  subject_type        text not null check (subject_type in ('COMPANY')),
  subject_id          uuid not null,
  provider            text check (provider is null or length(btrim(provider)) between 1 and 64),
  external_reference  text check (external_reference is null or length(btrim(external_reference)) between 1 and 256),
  title               text check (title is null or length(btrim(title)) between 1 and 200),
  -- Provenance only. Never fetched by this context.
  source_url          text check (source_url is null or (length(source_url) <= 2048 and source_url ~ '^https?://')),
  created_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  retrieved_at        timestamptz,
  published_at        timestamptz,
  reliability_class   text check (reliability_class is null or reliability_class in (
                        'PRIMARY_VERIFIED', 'PRIMARY_UNVERIFIED', 'AUTHORITATIVE_EXTERNAL',
                        'CREDIBLE_EXTERNAL', 'SECONDARY_EXTERNAL', 'USER_STATEMENT',
                        'MODEL_DERIVED', 'UNKNOWN')),
  visibility_scope    text not null check (visibility_scope in (
                        'personal_private', 'organisation_private', 'founder_private',
                        'investor_private', 'relationship_shared', 'specifically_shared',
                        'network_visible', 'public_external')),
  sensitivity_class   text not null check (sensitivity_class in (
                        'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                        'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- Sparse provenance metadata. Never document text, prompts or secrets.
  metadata            jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 4096),
  created_at          timestamptz not null default now(),
  unique (id, tenant_id)
);

comment on table evidence.sources is
  'Provenance: where a piece of information originated. A source is registered, never believed; PUBLIC_WEB is not "verified", DOCUMENT does not make a claim document-supported.';
comment on column evidence.sources.subject_id is
  'Resolved through the typed EvidenceSubjectResolverRegistry before insert; never a dynamic table lookup.';
comment on column evidence.sources.source_url is
  'Provenance data. The server never fetches it; external retrieval needs later connector infrastructure with SSRF controls.';
comment on column evidence.sources.reliability_class is
  'Source quality (doc 14 §43), never truth. Null = unassessed. No numeric weighting exists.';

create index sources_subject_idx
  on evidence.sources (tenant_id, subject_type, subject_id, created_at desc);

alter table evidence.sources enable row level security;

-- ---------------------------------------------------------------------------
-- Documents: one logical identity per document; bytes live in versions.
-- ---------------------------------------------------------------------------

create table evidence.documents (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  company_id            uuid,
  owner_organisation_id uuid not null,
  document_type         text not null default 'UNCLASSIFIED' check (document_type in (
                          'UNCLASSIFIED', 'PITCH_DECK', 'FINANCIAL_MODEL', 'MANAGEMENT_ACCOUNTS',
                          'COMPANY_PROFILE', 'FINANCIAL', 'LEGAL', 'CORPORATE', 'GOVERNANCE',
                          'PRODUCT', 'COMMERCIAL', 'CUSTOMER', 'OPERATIONAL', 'OTHER')),
  title                 text not null check (length(btrim(title)) between 1 and 200),
  visibility_scope      text not null default 'organisation_private' check (visibility_scope in (
                          'personal_private', 'organisation_private', 'founder_private',
                          'investor_private', 'relationship_shared', 'specifically_shared',
                          'network_visible', 'public_external')),
  sensitivity_class     text not null default 'CONFIDENTIAL' check (sensitivity_class in (
                          'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                          'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- Convenience projection; must belong to this document (trigger below).
  current_version_id    uuid,
  status                text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1 check (version >= 1),
  unique (id, tenant_id),
  -- Ownership coherence is relational: the organisation belongs to the tenant
  -- and the company (when named) belongs to the same tenant.
  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table evidence.documents is
  'Logical document identity ("FY2026 Financial Model"). Replacing the file creates a new version, never a new document. A document supports intelligence; it never becomes the company''s authoritative record by being uploaded.';
comment on column evidence.documents.owner_organisation_id is
  'Authoritative ownership. Derived from the actor''s active organisation on the server; never taken from the client.';
comment on column evidence.documents.sensitivity_class is
  'Server default CONFIDENTIAL (financial documents HIGHLY_CONFIDENTIAL). Browser input may strengthen, never weaken.';

create index documents_company_idx
  on evidence.documents (tenant_id, company_id) where company_id is not null;
create index documents_owner_idx
  on evidence.documents (owner_organisation_id, created_at desc, id desc);

create trigger set_updated_at
  before update on evidence.documents
  for each row execute function private.set_updated_at();

alter table evidence.documents enable row level security;

-- ---------------------------------------------------------------------------
-- Document versions: immutable file identity + evolving processing state.
-- ---------------------------------------------------------------------------

create table evidence.document_versions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  document_id            uuid not null,
  version_number         integer not null check (version_number >= 1),
  storage_bucket         text not null check (storage_bucket ~ '^[a-z][a-z0-9-]{1,62}$'),
  -- Random server-side identity. Knowing it grants nothing.
  storage_key            text not null check (storage_key ~ '^[a-z0-9][a-z0-9/_.-]{0,254}$' and position('..' in storage_key) = 0),
  original_filename      text not null check (length(original_filename) between 1 and 255 and original_filename !~ '[\\/]'),
  mime_type              text not null check (length(mime_type) between 3 and 129 and mime_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  size_bytes             bigint not null check (size_bytes >= 1),
  sha256                 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  uploaded_at            timestamptz not null default now(),
  supersedes_version_id  uuid,
  processing_status      text not null default 'NOT_STARTED' check (processing_status in (
                           'NOT_STARTED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  malware_scan_status    text not null default 'PENDING' check (malware_scan_status in (
                           'PENDING', 'CLEAN', 'BLOCKED', 'ERROR')),
  text_extraction_status text not null default 'NOT_STARTED' check (text_extraction_status in (
                           'NOT_STARTED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  unique (document_id, version_number),
  unique (id, document_id),
  unique (id, tenant_id),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  -- A superseded version belongs to the same document.
  foreign key (supersedes_version_id, document_id)
    references evidence.document_versions (id, document_id) on delete restrict,
  check (supersedes_version_id is null or supersedes_version_id <> id)
);

comment on table evidence.document_versions is
  'Immutable file versions. File identity (storage, filename, MIME, size, hash, uploader, supersedes) never changes after insert; only processing state evolves. A SHA-256 match is duplicate detection inside one organisation, never shared authorization.';

create index document_versions_document_uploaded_idx
  on evidence.document_versions (document_id, uploaded_at desc);
create index document_versions_sha256_idx
  on evidence.document_versions (tenant_id, sha256);

-- The current-version pointer must point into the same document.
alter table evidence.documents
  add constraint documents_current_version_fkey
  foreign key (current_version_id, id)
  references evidence.document_versions (id, document_id)
  on delete restrict deferrable initially deferred;

create or replace function evidence.protect_document_version_identity() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'document versions cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.document_id is distinct from old.document_id
     or new.tenant_id is distinct from old.tenant_id
     or new.version_number is distinct from old.version_number
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_key is distinct from old.storage_key
     or new.original_filename is distinct from old.original_filename
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.sha256 is distinct from old.sha256
     or new.uploaded_by_user_id is distinct from old.uploaded_by_user_id
     or new.uploaded_at is distinct from old.uploaded_at
     or new.supersedes_version_id is distinct from old.supersedes_version_id then
    raise exception 'document version file identity is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function evidence.protect_document_version_identity() from public;

create trigger document_versions_immutable
  before update or delete on evidence.document_versions
  for each row execute function evidence.protect_document_version_identity();

alter table evidence.document_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Processing runs: provenance of pipeline work. No pipeline exists yet.
-- ---------------------------------------------------------------------------

create table evidence.document_processing_runs (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references evidence.document_versions (id) on delete restrict,
  pipeline_version    text not null check (pipeline_version ~ '^[a-z][a-z0-9-]*-v[0-9]+$'),
  status              text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  started_at          timestamptz,
  completed_at        timestamptz,
  error_code          text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  extractor_version   text check (extractor_version is null or length(extractor_version) between 1 and 64),
  classifier_version  text check (classifier_version is null or length(classifier_version) between 1 and 64),
  embedding_model_id  text check (embedding_model_id is null or length(embedding_model_id) between 1 and 128),
  cost_usd            numeric(12, 6) not null default 0 check (cost_usd >= 0),
  metadata            jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 4096),
  created_at          timestamptz not null default now(),
  -- One logical run per pipeline version per document version (doc 13 §21.2).
  unique (document_version_id, pipeline_version),
  check (status <> 'COMPLETED' or completed_at is not null),
  check (error_code is null or status = 'FAILED')
);

comment on table evidence.document_processing_runs is
  'Provenance of document processing. CQ-EVD-001 records that a run exists; CQ-EVD-003 performs the work. Tenant scope comes through the document version.';

alter table evidence.document_processing_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Claims: assertions about a subject with three independent axes.
-- ---------------------------------------------------------------------------

create table evidence.claims (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  subject_type            text not null check (subject_type in ('COMPANY')),
  subject_id              uuid not null,
  claim_type              text not null check (claim_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' and length(claim_type) <= 64),
  claim_key               text not null check (claim_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' and length(claim_key) <= 128),
  statement               text not null check (length(btrim(statement)) between 1 and 2000),
  structured_value        jsonb check (structured_value is null or (jsonb_typeof(structured_value) = 'object' and length(structured_value::text) <= 8192)),
  asserted_by_type        text not null check (asserted_by_type in ('USER', 'ORGANISATION', 'SOURCE', 'SYSTEM')),
  asserted_by_id          uuid not null,
  asserted_at             timestamptz not null,
  valid_from              timestamptz,
  valid_to                timestamptz,
  truth_class             text not null check (truth_class in ('VERIFIED', 'USER_CLAIM', 'ESTIMATE', 'Q_INFERENCE', 'UNKNOWN')),
  evidence_status         text not null check (evidence_status in (
                            'NO_EVIDENCE', 'SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'MULTI_SOURCE_SUPPORTED',
                            'EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  lifecycle_status        text not null default 'CURRENT' check (lifecycle_status in (
                            'CURRENT', 'HISTORICAL', 'SUPERSEDED', 'DISPUTED', 'CONTRADICTORY', 'STALE')),
  visibility_scope        text not null default 'organisation_private' check (visibility_scope in (
                            'personal_private', 'organisation_private', 'founder_private',
                            'investor_private', 'relationship_shared', 'specifically_shared',
                            'network_visible', 'public_external')),
  sensitivity_class       text not null default 'CONFIDENTIAL' check (sensitivity_class in (
                            'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                            'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  current_revision_id     uuid not null,
  current_revision_number integer not null default 1 check (current_revision_number >= 1),
  created_at              timestamptz not null default now(),
  unique (id, tenant_id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to),
  -- A VERIFIED claim is one whose evidence verifies it; nothing else may say so.
  check (truth_class <> 'VERIFIED' or evidence_status in ('EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED'))
);

comment on table evidence.claims is
  'An assertion about a subject, never accepted truth and never canonical domain state. Current projection of the latest revision; corrections append to claim_revisions and move current_revision_id.';
comment on column evidence.claims.truth_class is 'ADR-001 axis 1: VERIFIED, USER_CLAIM, ESTIMATE, Q_INFERENCE, UNKNOWN. UNKNOWN is a valid answer.';
comment on column evidence.claims.evidence_status is 'ADR-001 axis 2: how the claim is supported.';
comment on column evidence.claims.lifecycle_status is 'ADR-001 axis 3: whether it is still the live assertion. CONTRADICTORY means investigation, never a penalty.';

create table evidence.claim_revisions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  claim_id         uuid not null,
  revision_number  integer not null check (revision_number >= 1),
  statement        text not null check (length(btrim(statement)) between 1 and 2000),
  structured_value jsonb check (structured_value is null or (jsonb_typeof(structured_value) = 'object' and length(structured_value::text) <= 8192)),
  truth_class      text not null check (truth_class in ('VERIFIED', 'USER_CLAIM', 'ESTIMATE', 'Q_INFERENCE', 'UNKNOWN')),
  evidence_status  text not null check (evidence_status in (
                     'NO_EVIDENCE', 'SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'MULTI_SOURCE_SUPPORTED',
                     'EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  lifecycle_status text not null check (lifecycle_status in (
                     'CURRENT', 'HISTORICAL', 'SUPERSEDED', 'DISPUTED', 'CONTRADICTORY', 'STALE')),
  valid_from       timestamptz,
  valid_to         timestamptz,
  change_reason    text check (change_reason is null or length(btrim(change_reason)) between 1 and 500),
  changed_by_type  text not null check (changed_by_type in ('USER', 'ORGANISATION', 'SOURCE', 'SYSTEM')),
  changed_by_id    uuid not null,
  source_id        uuid,
  created_at       timestamptz not null default now(),
  unique (claim_id, revision_number),
  unique (id, claim_id),
  foreign key (claim_id, tenant_id) references evidence.claims (id, tenant_id) on delete restrict deferrable initially deferred,
  foreign key (source_id, tenant_id) references evidence.sources (id, tenant_id) on delete restrict,
  check (revision_number > 1 or change_reason is null)
);

comment on table evidence.claim_revisions is
  'Append-only history of a claim. Revision 1 is the original assertion; every later row records what changed, why, and by whom. Never updated or deleted.';

alter table evidence.claims
  add constraint claims_current_revision_fkey
  foreign key (current_revision_id, id)
  references evidence.claim_revisions (id, claim_id)
  on delete restrict deferrable initially deferred;

create index claims_subject_key_idx
  on evidence.claims (tenant_id, subject_type, subject_id, claim_key);
create index claim_revisions_claim_idx
  on evidence.claim_revisions (claim_id, revision_number);

-- Revisions are history: no update, no delete.
create or replace function evidence.revisions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'claim revisions are append-only history' using errcode = 'check_violation';
end;
$$;
revoke all on function evidence.revisions_append_only() from public;

create trigger claim_revisions_append_only
  before update or delete on evidence.claim_revisions
  for each row execute function evidence.revisions_append_only();

-- The projection may only change together with a new current revision, and
-- identity columns never change at all.
create or replace function evidence.protect_claim_projection() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'claims cannot be deleted; supersede or dispute them through a revision' using errcode = 'check_violation';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.claim_type is distinct from old.claim_type
     or new.claim_key is distinct from old.claim_key
     or new.asserted_by_type is distinct from old.asserted_by_type
     or new.asserted_by_id is distinct from old.asserted_by_id
     or new.asserted_at is distinct from old.asserted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'claim identity is immutable' using errcode = 'check_violation';
  end if;
  if (new.statement is distinct from old.statement
      or new.structured_value is distinct from old.structured_value
      or new.truth_class is distinct from old.truth_class
      or new.evidence_status is distinct from old.evidence_status
      or new.lifecycle_status is distinct from old.lifecycle_status
      or new.valid_from is distinct from old.valid_from
      or new.valid_to is distinct from old.valid_to)
     and (new.current_revision_id = old.current_revision_id
          or new.current_revision_number <> old.current_revision_number + 1) then
    raise exception 'a claim changes only through a new revision' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function evidence.protect_claim_projection() from public;

create trigger claims_revise_only
  before update or delete on evidence.claims
  for each row execute function evidence.protect_claim_projection();

alter table evidence.claims enable row level security;
alter table evidence.claim_revisions enable row level security;

-- ---------------------------------------------------------------------------
-- Evidence items: something identified inside a source, with a locator.
-- ---------------------------------------------------------------------------

create table evidence.evidence_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  source_id         uuid not null,
  subject_type      text not null check (subject_type in ('COMPANY')),
  subject_id        uuid not null,
  evidence_type     text not null check (evidence_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' and length(evidence_type) <= 64),
  summary           text not null check (length(btrim(summary)) between 1 and 2000),
  structured_value  jsonb check (structured_value is null or (jsonb_typeof(structured_value) = 'object' and length(structured_value::text) <= 8192)),
  -- Typed locator ({kind: document|meeting|statement}). Traceability, never permission.
  locator           jsonb not null check (jsonb_typeof(locator) = 'object' and length(locator::text) <= 2048
                      and locator ? 'kind' and locator->>'kind' in ('document', 'meeting', 'statement')),
  valid_from        timestamptz,
  valid_to          timestamptz,
  evidence_status   text not null check (evidence_status in (
                      'SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'MULTI_SOURCE_SUPPORTED',
                      'EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  reliability_class text check (reliability_class is null or reliability_class in (
                      'PRIMARY_VERIFIED', 'PRIMARY_UNVERIFIED', 'AUTHORITATIVE_EXTERNAL',
                      'CREDIBLE_EXTERNAL', 'SECONDARY_EXTERNAL', 'USER_STATEMENT',
                      'MODEL_DERIVED', 'UNKNOWN')),
  visibility_scope  text not null check (visibility_scope in (
                      'personal_private', 'organisation_private', 'founder_private',
                      'investor_private', 'relationship_shared', 'specifically_shared',
                      'network_visible', 'public_external')),
  sensitivity_class text not null check (sensitivity_class in (
                      'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                      'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  created_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (source_id, tenant_id) references evidence.sources (id, tenant_id) on delete restrict,
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

comment on table evidence.evidence_items is
  'Evidence identified inside a source about the source''s subject. One source yields many items; the item is neither the source nor a claim. Never broader than its source; never less sensitive.';

create index evidence_items_subject_idx
  on evidence.evidence_items (tenant_id, subject_type, subject_id, created_at desc);
create index evidence_items_source_idx
  on evidence.evidence_items (source_id);

alter table evidence.evidence_items enable row level security;

create table evidence.claim_evidence (
  tenant_id          uuid not null,
  claim_id           uuid not null,
  evidence_item_id   uuid not null,
  relationship       text not null check (relationship in ('SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'SUPERSEDES')),
  -- Extension point only. No production weighting methodology exists.
  weight             numeric(6, 5) check (weight is null or (weight >= 0 and weight <= 1)),
  created_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  primary key (claim_id, evidence_item_id, relationship),
  foreign key (claim_id, tenant_id) references evidence.claims (id, tenant_id) on delete restrict,
  foreign key (evidence_item_id, tenant_id) references evidence.evidence_items (id, tenant_id) on delete restrict
);

comment on table evidence.claim_evidence is
  'Many-to-many claim ↔ evidence links. SUPPORTS and CONTRADICTS coexist on one claim; contradiction means investigation, never deletion and never a fraud conclusion.';

create index claim_evidence_claim_idx on evidence.claim_evidence (claim_id);
create index claim_evidence_item_idx on evidence.claim_evidence (evidence_item_id);

alter table evidence.claim_evidence enable row level security;

-- ---------------------------------------------------------------------------
-- Capabilities (production reference data; mirrored in the local seed).
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('document.create',   'Create a logical document owned by the active organisation.'),
  ('document.view',     'Read the organisation''s documents and their version metadata.'),
  ('document.download', 'Obtain authorised, short-lived access to a document version''s bytes.'),
  ('document.manage',   'Register versions, reclassify and archive the organisation''s documents.'),
  ('evidence.view',     'Read sources, claims and evidence items about subjects the organisation owns.'),
  ('evidence.record',   'Register sources, record claims and evidence items, and link evidence to claims.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'document.create'),
      ('organisation_admin',  'document.view'),
      ('organisation_admin',  'document.download'),
      ('organisation_admin',  'document.manage'),
      ('organisation_admin',  'evidence.view'),
      ('organisation_admin',  'evidence.record'),
      ('organisation_member', 'document.create'),
      ('organisation_member', 'document.view'),
      ('organisation_member', 'document.download'),
      ('organisation_member', 'evidence.view'),
      ('organisation_member', 'evidence.record')
    )
on conflict (role_id, capability_id) do nothing;
