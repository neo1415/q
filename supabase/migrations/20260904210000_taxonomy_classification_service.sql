-- CQ-TAX-002 · Taxonomy classification service
--
-- Provenance for language → canonical-node classification (doc 13 §16):
-- which classifier produced which ranked candidates for which subject,
-- under which exact taxonomy versions, at what cost -- and what a human
-- later decided. Forward migration only; CQ-TAX-001 is not rewritten.
--
-- Kept apart, permanently:
--
--   candidate ≠ canonical assignment ≠ verified fact
--   confidence = deterministic indicator, never a calibrated probability
--   classification run = provenance; audit = who changed canonical state
--   raw language lives in its owning source / entity_assignments.raw_source_text,
--   never in classification_runs.metadata
--
-- Lexical search: pg_trgm (typo tolerance + word similarity), installed in
-- the extensions schema like btree_gist. No pgvector, no embeddings, no
-- model provenance columns beyond the generic provider/model/version.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- taxonomy.classification_runs
-- ---------------------------------------------------------------------------

create table taxonomy.classification_runs (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  -- Typed subject; resolved by the application's subject resolver, never a table name.
  subject_type         text not null check (subject_type in ('COMPANY')),
  subject_id           uuid not null,
  -- Canonical input source reference (application-resolved; no generic FK).
  input_source_type    text check (input_source_type is null or (input_source_type ~ '^[A-Z][A-Z0-9_]*$' and length(input_source_type) <= 64)),
  input_source_id      uuid,
  -- Honest classifier identity: capital_q / deterministic_lexical / taxonomy-lexical-v1 today;
  -- a future model adapter records its provider, model and prompt/classifier version here.
  classifier_provider  text not null check (classifier_provider ~ '^[a-z][a-z0-9_]*$' and length(classifier_provider) <= 64),
  classifier_model     text not null check (length(classifier_model) between 1 and 128),
  classifier_version   text not null check (length(classifier_version) between 1 and 64),
  -- Snapshot of the vocabulary version set in force: {"industry": 1, ...} (ADR 0005 / ADR 0006).
  taxonomy_version     jsonb not null check (jsonb_typeof(taxonomy_version) = 'object'),
  status               text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'ABSTAINED', 'FAILED')),
  started_at           timestamptz not null default clock_timestamp(),
  completed_at         timestamptz,
  -- Exact money semantics; deterministic runs cost 0.
  cost_usd             numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- Bounded, safe metadata only: strategy, resolution, counts, vocabulary codes,
  -- abstention reason, input hash/length, failure code. Never raw text.
  metadata             jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 4096
                              and not (metadata ? 'text') and not (metadata ? 'rawText')
                              and not (metadata ? 'prompt') and not (metadata ? 'response')),

  check ((input_source_type is null) = (input_source_id is null)),
  check ((status = 'RUNNING') = (completed_at is null)),
  check (completed_at is null or completed_at >= started_at)
);

comment on table taxonomy.classification_runs is
  'Provenance of one classification: subject, input source reference, classifier identity/version, taxonomy version set, lifecycle, cost. Never audit; never raw text. Server-internal.';

create index classification_runs_subject_idx
  on taxonomy.classification_runs (tenant_id, subject_type, subject_id, started_at desc);
create index classification_runs_status_idx
  on taxonomy.classification_runs (status, started_at);
create index classification_runs_input_source_idx
  on taxonomy.classification_runs (input_source_type, input_source_id)
  where input_source_id is not null;

-- ---------------------------------------------------------------------------
-- taxonomy.classification_candidates
-- ---------------------------------------------------------------------------

create table taxonomy.classification_candidates (
  classification_run_id  uuid not null references taxonomy.classification_runs (id) on delete restrict,
  node_id                uuid not null references taxonomy.nodes (id) on delete restrict,
  -- 1-based, unique within the run.
  rank                   integer not null check (rank >= 1),
  -- Deterministic indicator in [0, 1]; exact numeric, never float; never a probability.
  confidence             numeric(5, 4) not null check (confidence >= 0 and confidence <= 1),
  -- How the node was found. Closed set; provenance of the suggestion, not of the company.
  match_types            text[] not null check (
                           cardinality(match_types) >= 1
                           and match_types <@ array['CANONICAL_CODE_EXACT', 'ALIAS_EXACT', 'DISPLAY_NAME_EXACT', 'LEXICAL']::text[]),
  -- Short observable reason. Never hidden reasoning, never the input.
  rationale_summary      text not null check (length(rationale_summary) between 1 and 300),
  -- Tri-state: null = unresolved, true = accepted, false = rejected. History, never deleted.
  accepted               boolean,
  decided_by_user_id     uuid references identity.user_profiles (id) on delete restrict,
  decided_at             timestamptz,

  primary key (classification_run_id, node_id),
  unique (classification_run_id, rank),
  check ((accepted is null) = (decided_at is null)),
  check ((decided_by_user_id is null) = (decided_at is null))
);

comment on table taxonomy.classification_candidates is
  'Ranked candidates of a classification run. A candidate is a suggestion; canonical truth lives in taxonomy.entity_assignments after human confirmation. Rejections are kept as evaluation data.';

-- ---------------------------------------------------------------------------
-- Provenance link from confirmed assignments to their run (column from CQ-TAX-001).
-- RESTRICT: provenance never disappears from under an accepted assignment.
-- ---------------------------------------------------------------------------

alter table taxonomy.entity_assignments
  add constraint entity_assignments_classification_run_fk
  foreign key (classification_run_id) references taxonomy.classification_runs (id) on delete restrict;

create index entity_assignments_classification_run_idx
  on taxonomy.entity_assignments (classification_run_id)
  where classification_run_id is not null;

-- No trigram index: lexical retrieval calls word_similarity() over a few
-- hundred candidate texts (query plans confirm sequential scans are the
-- right choice at this size, and GIN trigram indexes only serve the
-- operator forms). Exact lookups reuse the CQ-TAX-001 btree indexes. Add a
-- trigram index by forward migration when the plans justify it.

-- ---------------------------------------------------------------------------
-- Exposure: INTERNAL_SERVER_ONLY. Runs reveal what a tenant is classifying.
-- ---------------------------------------------------------------------------

alter table taxonomy.classification_runs enable row level security;
alter table taxonomy.classification_candidates enable row level security;
-- No policies, no anon/authenticated/service_role grants.
