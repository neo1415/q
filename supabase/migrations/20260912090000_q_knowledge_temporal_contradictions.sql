-- CQ-KNW-003 · time and disagreement: knowledge that changes, and sources that
-- legitimately differ (doc 13 §41.3, doc 14 §41-§56, doc 15 §19-§22,
-- doc 16 TM-RAG-08).
--
--   historical ≠ false;  old ≠ wrong;  corrected ≠ fraudulent
--   different ≠ contradictory;  disputed ≠ rejected;  superseded ≠ deleted
--   stale ≠ incorrect;  latest ≠ most reliable;  highest ≠ true
--
-- Two things change here. "Current" stops being a status and becomes a
-- consequence of validity, so a metric can have a history instead of a
-- single row. And disagreement gets somewhere durable to live, so that
-- preserving both readings is a recorded state rather than an absence of
-- one.

-- ---------------------------------------------------------------------------
-- Measurement context. Two numbers can differ for entirely legitimate
-- reasons, and comparing them without knowing which reason applies is how a
-- system reports growth as fraud.
-- ---------------------------------------------------------------------------

alter table q_knowledge.objects
  add column definition_qualifier text
    check (definition_qualifier is null or
           (definition_qualifier ~ '^[a-z][a-z0-9_]{0,63}$')),
  add column measurement_basis text not null default 'ACTUAL'
    check (measurement_basis in ('ACTUAL', 'FORECAST', 'ESTIMATE', 'UNSPECIFIED')),
  -- When the understanding was last checked against its source, which is not
  -- when it was recorded and not when it became true.
  add column last_verified_at timestamptz;

comment on column q_knowledge.objects.definition_qualifier is
  'How the metric is defined, when a subject measures one thing more than one way (gross, net_of_churn). Two understandings of the same key under different definitions are an accepted difference, not a contradiction.';
comment on column q_knowledge.objects.measurement_basis is
  'ACTUAL, FORECAST or ESTIMATE. A forecast of 4m and an actual of 2m are not in conflict; treating them as such is a category error, not a discrepancy.';
comment on column q_knowledge.objects.last_verified_at is
  'When this understanding was last checked against its source. Freshness, never permission: an old founder-private figure is still founder-private.';

-- ---------------------------------------------------------------------------
-- One ACTIVE understanding per (subject, key, definition, period).
--
-- CQ-KNW-002 allowed one ACTIVE row per key, which made "current" a status.
-- A metric with a history cannot live under that rule: January, June and
-- August ARR are all true, of different months. So the constraint moves down
-- to the period, "current" becomes the ACTIVE row with the latest effective
-- date, and the only thing still forbidden is two settled answers to the
-- same question about the same period — which is exactly a contradiction,
-- and is held rather than stored.
-- ---------------------------------------------------------------------------

drop index q_knowledge.objects_one_active_per_key_idx;

create unique index objects_one_active_per_period_idx
  on q_knowledge.objects (
    tenant_id, subject_type, subject_id, knowledge_key,
    coalesce(definition_qualifier, ''),
    measurement_basis,
    coalesce(valid_from, '-infinity'::timestamptz)
  )
  where status = 'ACTIVE';

-- The current-and-history lookup: everything ACTIVE for one metric, newest
-- effective date first. `recorded_at` stands in when a source attached no
-- period, because an undated statement is about the moment it was made.
create index objects_effective_idx
  on q_knowledge.objects (
    tenant_id, subject_type, subject_id, knowledge_key,
    (coalesce(valid_from, recorded_at)) desc
  )
  where status in ('ACTIVE', 'SUPERSEDED', 'DISPUTED', 'STALE');

-- ---------------------------------------------------------------------------
-- Corrections. A correction restates a period that was already recorded; a
-- new value describes a different period. Conflating them turns a fixed typo
-- into a reported decline.
-- ---------------------------------------------------------------------------

alter table q_knowledge.revisions
  add column correction_of_revision_id uuid
    references q_knowledge.revisions (id) on delete restrict;

comment on column q_knowledge.revisions.correction_of_revision_id is
  'Set when this revision corrects an earlier one about the SAME period. Null means the value changed, not that it was wrong. Both revisions survive either way.';

-- ---------------------------------------------------------------------------
-- Contradiction sets: somewhere for disagreement to live.
--
-- A set is metadata about private material and inherits its members'
-- classification: "these two figures conflict" can disclose as much as the
-- figures. It carries no statement and no value — only which understandings
-- disagree and why nobody has settled it.
-- ---------------------------------------------------------------------------

create table q_knowledge.contradiction_sets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  subject_type          text not null check (subject_type in ('COMPANY')),
  subject_id            uuid not null,
  knowledge_key         text not null check (
                          knowledge_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
                          and length(knowledge_key) <= 128),
  definition_qualifier  text,
  measurement_basis     text not null check (measurement_basis in (
                          'ACTUAL', 'FORECAST', 'ESTIMATE', 'UNSPECIFIED')),
  -- The contested period. Null means the disagreement is about undated
  -- assertions, which is still a disagreement.
  contested_from        timestamptz,
  -- Why the two are incompatible. A code, so telemetry and tests can read it
  -- and no private value has to travel to explain it.
  conflict_kind         text not null check (conflict_kind in (
                          'VALUE_MISMATCH', 'UNIT_MISMATCH', 'CURRENCY_MISMATCH')),
  -- Whether this is worth a person's attention. UNDETERMINED is honest and
  -- common: no calibrated materiality methodology exists in this repository.
  materiality           text not null default 'UNDETERMINED' check (materiality in (
                          'MATERIAL', 'IMMATERIAL', 'UNDETERMINED')),
  status                text not null default 'OPEN' check (status in (
                          'OPEN', 'RESOLVED', 'ACCEPTED_DIFFERENCE', 'SUPERSEDED')),
  -- Inherited from the members, never softened because a set is "only"
  -- metadata (§51).
  visibility_scope      text not null check (visibility_scope in (
                          'personal_private', 'organisation_private', 'founder_private',
                          'investor_private', 'relationship_shared', 'specifically_shared',
                          'network_visible', 'public_external')),
  sensitivity_class     text not null check (sensitivity_class in (
                          'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                          'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  resolution_reason     text check (resolution_reason is null or resolution_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (id, tenant_id),
  check ((status in ('OPEN')) = (resolved_at is null)),
  check (status <> 'OPEN' or resolution_reason is null)
);

comment on table q_knowledge.contradiction_sets is
  'A recorded disagreement between settled understandings of the same metric, definition, basis and period. Resolution preserves every member; nothing here deletes a reading, and no rule prefers the larger or the newer one.';
comment on column q_knowledge.contradiction_sets.materiality is
  'MATERIAL, IMMATERIAL or UNDETERMINED. No universal percentage threshold is invented: without a calibrated methodology, UNDETERMINED is the truthful answer and a person decides.';

-- One open disagreement per contested question. A second challenger joins
-- the existing set rather than starting a parallel argument.
create unique index contradiction_sets_one_open_idx
  on q_knowledge.contradiction_sets (
    tenant_id, subject_type, subject_id, knowledge_key,
    coalesce(definition_qualifier, ''), measurement_basis,
    coalesce(contested_from, '-infinity'::timestamptz)
  )
  where status = 'OPEN';
create index contradiction_sets_subject_idx
  on q_knowledge.contradiction_sets (tenant_id, subject_type, subject_id, status);

create table q_knowledge.contradiction_members (
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  contradiction_set_id  uuid not null,
  knowledge_object_id   uuid not null,
  -- INCUMBENT was the settled understanding; CHALLENGER arrived and
  -- disagreed. Neither word means right or wrong.
  role                  text not null check (role in ('INCUMBENT', 'CHALLENGER')),
  created_at            timestamptz not null default now(),
  primary key (contradiction_set_id, knowledge_object_id),
  foreign key (contradiction_set_id, tenant_id)
    references q_knowledge.contradiction_sets (id, tenant_id) on delete cascade,
  -- Composite, so a member from another tenant is unwritable rather than
  -- merely unlikely.
  foreign key (knowledge_object_id, tenant_id)
    references q_knowledge.objects (id, tenant_id) on delete cascade
);

comment on table q_knowledge.contradiction_members is
  'Which understandings disagree. References, never copies: the statements and values stay on the objects, where their permissions already live.';

create index contradiction_members_object_idx
  on q_knowledge.contradiction_members (knowledge_object_id);

-- Resolution is an outcome, not an edit: a resolved set keeps every member
-- and every reason.
create or replace function q_knowledge.protect_contradiction_set() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.knowledge_key is distinct from old.knowledge_key
     or new.definition_qualifier is distinct from old.definition_qualifier
     or new.measurement_basis is distinct from old.measurement_basis
     or new.contested_from is distinct from old.contested_from
     or new.created_at is distinct from old.created_at then
    raise exception 'a contradiction''s identity is immutable; open a new set instead'
      using errcode = 'check_violation';
  end if;
  if old.status <> 'OPEN' and new.status = 'OPEN' then
    raise exception 'a settled contradiction is not reopened by editing it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_knowledge.protect_contradiction_set() from public;

create trigger contradiction_sets_protect
  before update on q_knowledge.contradiction_sets
  for each row execute function q_knowledge.protect_contradiction_set();

-- Server-internal, like everything else in this schema.
alter table q_knowledge.contradiction_sets enable row level security;
alter table q_knowledge.contradiction_members enable row level security;
