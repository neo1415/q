-- CQ-REC-004 · recommendation.feature_snapshots: the V1 feature store
-- (doc 19 §38–§42, §144–§147; doc 13 §41.2; doc 15 §20–§21).
--
--   feature value ≠ feature weight ≠ score ≠ rank ≠ explanation
--   feature snapshot ≠ company truth ≠ investor truth ≠ candidate provenance
--   MISSING ≠ zero;  internal feature ≠ founder-visible fact
--
-- A snapshot is a derived, versioned, immutable artifact: the governed
-- feature values one investor's ACTIVE mandate produced for one eligible
-- company under one recommendation context and one feature schema. It is
-- what a ranker reads and what a later slate can be reproduced from. It is
-- rebuilt when its inputs change (a new fingerprint supersedes the current
-- row) and never edited in place, so an old slate can always be explained
-- by the snapshot it was ranked from.
--
-- The payload is a STRICTLY validated, bounded, versioned JSON array of
-- typed feature values (the application contract validates every row before
-- insert; the database bounds its shape). It is derived recommendation
-- infrastructure, not a canonical business schema, and holds identifiers,
-- codes, versions and typed values only — never raw mandate text, never a
-- company field, never a private source excerpt.

create table recommendation.feature_snapshots (
  id                          uuid primary key default gen_random_uuid(),
  -- The investor's tenant: the artifact carries the investor's own private
  -- mandate signals and is owned by the investor's side.
  tenant_id                   uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id    uuid not null,
  mandate_id                  uuid not null,
  mandate_version             integer not null check (mandate_version >= 1),
  -- The company the features describe, in its own tenant.
  company_id                  uuid not null,
  company_tenant_id           uuid not null,
  company_projection_version  integer not null check (company_projection_version >= 1),
  -- The recommendation context the features were allowed in.
  mode                        text not null check (mode in ('INVESTOR_DISCOVER', 'FOUNDER_DISCOVER', 'GATEQ', 'SEARCH', 'Q_RECOMMENDATION')),
  feature_schema_version      text not null check (feature_schema_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  eligibility_policy_version  text not null check (eligibility_policy_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  eligibility_decision        text not null check (eligibility_decision in ('ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED')),
  structured_generator_version text check (structured_generator_version is null or structured_generator_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  semantic_generator_version  text check (semantic_generator_version is null or semantic_generator_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  -- vocabulary code → version, when recorded.
  taxonomy_version            jsonb check (taxonomy_version is null or jsonb_typeof(taxonomy_version) = 'object'),
  -- REC-002 / REC-003 provenance for the candidate: generator, representation
  -- and configuration versions and reason codes only (SnapshotCandidateProvenance).
  candidate_provenance        jsonb not null check (jsonb_typeof(candidate_provenance) = 'object'),
  -- The artifact's own class: the highest of its values' classes.
  sensitivity                 text not null check (sensitivity in ('PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  -- The typed feature values, in registry order. Bounded array; validated
  -- by the application contract (RecommendationFeatureSnapshotSchema).
  features                    jsonb not null
                                check (jsonb_typeof(features) = 'array' and jsonb_array_length(features) between 1 and 64),
  -- sha256 over the semantic inputs and values; never over computed_at or id.
  fingerprint                 text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status                      text not null default 'CURRENT' check (status in ('CURRENT', 'SUPERSEDED')),
  computed_at                 timestamptz not null,
  created_at                  timestamptz not null default now(),
  superseded_at               timestamptz,
  constraint feature_snapshots_status_matches_supersession
    check ((status = 'CURRENT') = (superseded_at is null)),
  constraint feature_snapshots_generator_present
    check (structured_generator_version is not null or semantic_generator_version is not null),
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete cascade,
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete cascade,
  foreign key (company_id, company_tenant_id)
    references core.companies (id, tenant_id) on delete cascade
);

comment on table recommendation.feature_snapshots is
  'Derived, versioned, immutable recommendation feature snapshots (doc 19 §147): the governed values one investor mandate produced for one eligible company under one context and feature schema. Not company truth, not investor truth, not an explanation. Investor-private signals inside; server-internal; never a browser API.';
comment on column recommendation.feature_snapshots.features is
  'Typed feature values in registry order, validated by the application contract before insert. Identifiers, codes, versions and typed values only: never raw mandate text, never a company field, never a private source excerpt.';
comment on column recommendation.feature_snapshots.fingerprint is
  'Deterministic identity of the semantic inputs and values. Same inputs and versions, same fingerprint; used to reuse an identical snapshot and to supersede a changed one.';

-- One CURRENT snapshot per investor organisation, mandate, company, context
-- and schema version. A new fingerprint supersedes; the same one is reused.
create unique index feature_snapshots_current_key
  on recommendation.feature_snapshots (investor_organisation_id, mandate_id, company_id, mode, feature_schema_version)
  where status = 'CURRENT';
create index feature_snapshots_investor_idx
  on recommendation.feature_snapshots (tenant_id, investor_organisation_id, mandate_id);
create index feature_snapshots_company_idx
  on recommendation.feature_snapshots (company_tenant_id, company_id);

-- Immutability: a snapshot's identity and payload are never edited. The one
-- allowed update is supersession (status + superseded_at); a superseded
-- snapshot never becomes current again. Deletion stays available: the
-- artifact is rebuildable and cascades with its canonical rows.
create or replace function recommendation.protect_feature_snapshot() returns trigger
language plpgsql as $$
begin
  if new.features is distinct from old.features
     or new.fingerprint is distinct from old.fingerprint
     or new.feature_schema_version is distinct from old.feature_schema_version
     or new.mandate_id is distinct from old.mandate_id
     or new.mandate_version is distinct from old.mandate_version
     or new.company_id is distinct from old.company_id
     or new.mode is distinct from old.mode
     or new.sensitivity is distinct from old.sensitivity
     or new.candidate_provenance is distinct from old.candidate_provenance
     or new.tenant_id is distinct from old.tenant_id
     or new.computed_at is distinct from old.computed_at then
    raise exception 'a feature snapshot is immutable; compute a new one and supersede this one'
      using errcode = 'check_violation';
  end if;
  if old.status = 'SUPERSEDED' and new.status = 'CURRENT' then
    raise exception 'a superseded feature snapshot never becomes current again'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function recommendation.protect_feature_snapshot() from public;

create trigger feature_snapshots_immutable
  before update on recommendation.feature_snapshots
  for each row execute function recommendation.protect_feature_snapshot();

-- Server-only, like the rest of the schema: RLS on, no policy, no browser
-- grant. A founder never reads an investor's feature vector; a browser
-- never writes a feature value.
alter table recommendation.feature_snapshots enable row level security;
