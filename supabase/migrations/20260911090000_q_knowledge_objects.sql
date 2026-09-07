-- CQ-KNW-002 · q_knowledge: what Capital Q understands, as opposed to what a
-- source said (doc 13 §41.3, doc 14 §30-§40, doc 15 §19-§22).
--
--   Claim ≠ Knowledge Object ≠ canonical company state ≠ Data Room ≠ audit
--   evidence status ≠ confidence ≠ truth class;  Q knows ≠ a user may know
--   document-supported ≠ verified;  historical ≠ false;  unknown ≠ negative
--
-- A Knowledge Object is Capital Q's current understanding of one fact about
-- one subject, carrying the evidence it rests on and the confidence that
-- evidence justifies. It is derived, revisable and never authoritative over
-- the owning domain: the canonical raise target lives in core, and nothing
-- here may contradict it by existing.
--
-- Server-internal. RLS is enabled with no policy and no grant: reads go
-- through the application's permission-aware query service, never the
-- browser, and DB bypass is never business authorisation.

-- ---------------------------------------------------------------------------
-- Objects. Direct tenant ownership, typed subject, the three independent
-- axes, a confidence class that a rule produced, and a current-revision
-- projection over an append-only history.
-- ---------------------------------------------------------------------------

create table q_knowledge.objects (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  subject_type              text not null check (subject_type in ('COMPANY')),
  subject_id                uuid not null,
  -- What kind of understanding this is. `fact` and `observation` rest on a
  -- source; `inference` is Q's own conclusion and says so.
  knowledge_type            text not null check (knowledge_type in ('fact', 'observation', 'inference')),
  -- The identity of the understanding. Two assertions are the same fact when
  -- they share a subject and a key, never when they share a number:
  -- financial.arr and capital.raise_target are both often "$2m".
  knowledge_key             text not null check (
                              knowledge_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
                              and length(knowledge_key) <= 128),
  statement                 text not null check (length(btrim(statement)) between 1 and 2000),
  structured_value          jsonb check (structured_value is null or
                              (jsonb_typeof(structured_value) = 'object' and length(structured_value::text) <= 8192)),
  -- ADR-001's three axes, never one enum. VERIFIED is constrained below.
  truth_class               text not null check (truth_class in (
                              'VERIFIED', 'USER_CLAIM', 'ESTIMATE', 'Q_INFERENCE', 'UNKNOWN')),
  evidence_status           text not null check (evidence_status in (
                              'NO_EVIDENCE', 'SELF_REPORTED', 'DOCUMENT_SUPPORTED',
                              'MULTI_SOURCE_SUPPORTED', 'EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  -- A category a deterministic rule produced, never a percentage and never a
  -- model's own estimate of itself.
  confidence_class          text not null check (confidence_class in (
                              'HIGH', 'MODERATE', 'LOW', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE')),
  reliability_class         text check (reliability_class is null or reliability_class in (
                              'PRIMARY_VERIFIED', 'PRIMARY_UNVERIFIED', 'AUTHORITATIVE_EXTERNAL',
                              'CREDIBLE_EXTERNAL', 'SECONDARY_EXTERNAL', 'USER_STATEMENT',
                              'MODEL_DERIVED', 'UNKNOWN')),
  valid_from                timestamptz,
  valid_to                  timestamptz,
  -- When Capital Q came to understand this, which is not when it became true.
  recorded_at               timestamptz not null default now(),
  source_environment        text not null default 'PLATFORM' check (source_environment in (
                              'PLATFORM', 'DOCUMENT', 'CONVERSATION', 'MEETING', 'INTEGRATION', 'PUBLIC')),
  visibility_scope          text not null check (visibility_scope in (
                              'personal_private', 'organisation_private', 'founder_private',
                              'investor_private', 'relationship_shared', 'specifically_shared',
                              'network_visible', 'public_external')),
  sensitivity_class         text not null check (sensitivity_class in (
                              'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                              'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- CANDIDATE covers both "proposed" and "held": a candidate awaiting a
  -- person is not a ninth lifecycle value, it is a candidate with a reason.
  status                    text not null default 'CANDIDATE' check (status in (
                              'CANDIDATE', 'ACTIVE', 'REJECTED', 'SUPERSEDED',
                              'DISPUTED', 'STALE', 'REVOKED', 'ARCHIVED')),
  hold_reason               text check (hold_reason is null or hold_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  -- Set when the evidence underneath changed and the object has not been
  -- re-derived yet. Trusted knowledge whose support vanished must not simply
  -- carry on looking trusted.
  reassessment_required_at  timestamptz,
  reassessment_reason       text check (reassessment_reason is null or reassessment_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  current_revision_id       uuid,
  current_revision_number   integer not null default 1 check (current_revision_number >= 1),
  created_at                timestamptz not null default now(),
  unique (id, tenant_id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to),
  -- The same rule the Evidence context enforces: a VERIFIED understanding
  -- requires evidence that actually verified something. No number of
  -- documents agreeing, and no confident model, reaches this.
  check (truth_class <> 'VERIFIED' or evidence_status in ('EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  -- An inference is Q's conclusion; recording one as a source assertion
  -- would misattribute it to the subject.
  check (knowledge_type <> 'inference' or truth_class = 'Q_INFERENCE'),
  check ((status = 'CANDIDATE') or hold_reason is null)
);

comment on table q_knowledge.objects is
  'What Capital Q currently understands about a subject, derived from claims and evidence. Not canonical company state, not the Data Room, not audit, not model memory. Existing here grants nobody permission to read it.';
comment on column q_knowledge.objects.confidence_class is
  'A category produced by a deterministic rule from truth class, evidence status and source independence. Never a percentage, never a model''s own estimate of itself.';
comment on column q_knowledge.objects.status is
  'CANDIDATE covers proposed and held. ACTIVE is Capital Q''s current understanding. DISPUTED, SUPERSEDED, STALE, REVOKED and ARCHIVED are later lifecycle; CQ-KNW-003 owns contradiction resolution.';

-- One ACTIVE understanding per subject per key. A second one is not a
-- competing opinion, it is a bug that would make "what do we know?"
-- ambiguous.
create unique index objects_one_active_per_key_idx
  on q_knowledge.objects (tenant_id, subject_type, subject_id, knowledge_key)
  where status = 'ACTIVE';
create index objects_subject_idx
  on q_knowledge.objects (tenant_id, subject_type, subject_id);
create index objects_subject_key_idx
  on q_knowledge.objects (tenant_id, subject_type, subject_id, knowledge_key);
create index objects_reassessment_idx
  on q_knowledge.objects (tenant_id, reassessment_required_at)
  where reassessment_required_at is not null;

-- ---------------------------------------------------------------------------
-- Revisions. Append-only: an understanding that changes gains a revision and
-- keeps the old one. "ARR was 1.8m in March and 2.4m in July" must remain
-- reconstructable, and so must "we lowered our confidence when the evidence
-- was withdrawn".
-- ---------------------------------------------------------------------------

create table q_knowledge.revisions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  knowledge_object_id  uuid not null,
  revision_number      integer not null check (revision_number >= 1),
  statement            text not null check (length(btrim(statement)) between 1 and 2000),
  structured_value     jsonb check (structured_value is null or
                         (jsonb_typeof(structured_value) = 'object' and length(structured_value::text) <= 8192)),
  truth_class          text not null check (truth_class in (
                         'VERIFIED', 'USER_CLAIM', 'ESTIMATE', 'Q_INFERENCE', 'UNKNOWN')),
  evidence_status      text not null check (evidence_status in (
                         'NO_EVIDENCE', 'SELF_REPORTED', 'DOCUMENT_SUPPORTED',
                         'MULTI_SOURCE_SUPPORTED', 'EXTERNALLY_VERIFIED', 'PLATFORM_VERIFIED')),
  confidence_class     text not null check (confidence_class in (
                         'HIGH', 'MODERATE', 'LOW', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE')),
  valid_from           timestamptz,
  valid_to             timestamptz,
  change_reason        text not null check (change_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_by_type      text not null check (created_by_type in ('USER', 'SYSTEM', 'Q')),
  created_by_id        uuid,
  created_at           timestamptz not null default now(),
  unique (knowledge_object_id, revision_number),
  foreign key (knowledge_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade
);

comment on table q_knowledge.revisions is
  'Append-only history of one knowledge object. The current projection on the object is a convenience; this is the record. Nothing is ever overwritten.';

create index revisions_object_idx
  on q_knowledge.revisions (knowledge_object_id, revision_number desc);

alter table q_knowledge.objects
  add constraint objects_current_revision_fk
  foreign key (current_revision_id) references q_knowledge.revisions (id) deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Provenance. An object may rest on many evidence items and many sources;
-- one evidence row per object was never going to be enough, and a knowledge
-- object that cannot answer "where did this come from?" is an opinion.
-- ---------------------------------------------------------------------------

create table q_knowledge.object_evidence (
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  knowledge_object_id  uuid not null,
  evidence_item_id     uuid not null,
  -- The same vocabulary claim_evidence uses. Contradicting evidence is kept:
  -- deleting the inconvenient source is how a system starts lying.
  relationship         text not null check (relationship in ('SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'SUPERSEDES')),
  created_at           timestamptz not null default now(),
  primary key (knowledge_object_id, evidence_item_id, relationship),
  foreign key (knowledge_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade,
  -- The composite key is what makes cross-tenant provenance unwritable
  -- rather than merely unlikely.
  foreign key (evidence_item_id, tenant_id)
    references evidence.evidence_items (id, tenant_id) on delete restrict
);

comment on table q_knowledge.object_evidence is
  'Which evidence items an understanding rests on, and how. Contradicting evidence is recorded, never removed.';

create index object_evidence_object_idx on q_knowledge.object_evidence (knowledge_object_id);
create index object_evidence_item_idx on q_knowledge.object_evidence (evidence_item_id);

create table q_knowledge.object_sources (
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  knowledge_object_id  uuid not null,
  source_id            uuid not null,
  created_at           timestamptz not null default now(),
  primary key (knowledge_object_id, source_id),
  foreign key (knowledge_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade,
  foreign key (source_id, tenant_id)
    references evidence.sources (id, tenant_id) on delete restrict
);

comment on table q_knowledge.object_sources is
  'Which registered sources stand behind an understanding. Distinctness here is what MULTI_SOURCE_SUPPORTED means; two passages of one document are one source.';

create index object_sources_source_idx on q_knowledge.object_sources (source_id);

-- ---------------------------------------------------------------------------
-- Lineage. Which derived conclusions depend on which understandings, so a
-- withdrawn input can be traced to everything that rested on it. A bounded
-- relationship vocabulary, not a general graph API.
-- ---------------------------------------------------------------------------

create table q_knowledge.lineage (
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  parent_object_id  uuid not null,
  child_object_id   uuid not null,
  relationship      text not null check (relationship in (
                      'derived_from', 'depends_on', 'supports', 'reassesses', 'supersedes')),
  created_at        timestamptz not null default now(),
  primary key (parent_object_id, child_object_id, relationship),
  check (parent_object_id <> child_object_id),
  foreign key (parent_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade,
  foreign key (child_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade
);

comment on table q_knowledge.lineage is
  'Derivation between knowledge objects, so reassessment and deletion can propagate. Bounded relationships only; not a general-purpose graph.';

create index lineage_parent_idx on q_knowledge.lineage (parent_object_id);
create index lineage_child_idx on q_knowledge.lineage (child_object_id);

-- ---------------------------------------------------------------------------
-- Identity and history are immutable. An understanding changes by gaining a
-- revision; it never changes by having its past edited.
-- ---------------------------------------------------------------------------

create or replace function q_knowledge.protect_knowledge_object() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.knowledge_key is distinct from old.knowledge_key
     or new.created_at is distinct from old.created_at
     or new.recorded_at is distinct from old.recorded_at then
    raise exception 'knowledge identity and provenance are immutable; revise the object instead'
      using errcode = 'check_violation';
  end if;
  if new.current_revision_number < old.current_revision_number then
    raise exception 'revision numbers never go backwards'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_knowledge.protect_knowledge_object() from public;

create trigger objects_protect
  before update on q_knowledge.objects
  for each row execute function q_knowledge.protect_knowledge_object();

create or replace function q_knowledge.revisions_are_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'knowledge revisions are append-only; add a revision instead'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_knowledge.revisions_are_append_only() from public;

create trigger revisions_append_only
  before update or delete on q_knowledge.revisions
  for each row execute function q_knowledge.revisions_are_append_only();

-- ---------------------------------------------------------------------------
-- Server-internal. RLS on, no policy, no grant: there is no browser path to
-- a knowledge object, and existing in this schema is not permission to read.
-- ---------------------------------------------------------------------------

alter table q_knowledge.objects enable row level security;
alter table q_knowledge.revisions enable row level security;
alter table q_knowledge.object_evidence enable row level security;
alter table q_knowledge.object_sources enable row level security;
alter table q_knowledge.lineage enable row level security;
