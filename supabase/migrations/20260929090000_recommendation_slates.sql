-- CQ-REC-006 · recommendation.slates, slate_items, refresh_requests and the
-- refresh queue: precomputed, durable, version-reproducible recommendation
-- slates (doc 19 §10, §62–§65, §149–§151; doc 20 §76–§81; doc 13 §41.2).
--
--   slate ≠ company truth ≠ investor truth ≠ relationship ≠ interest ≠ match
--   slate item ≠ explanation (REC-007);  internal score ≠ public number
--   one CURRENT slate per investor organisation, mandate and context
--   readers see an old valid slate or a new complete one, never a partial set
--
-- A slate is the persisted output of one run of the recommendation pipeline
-- (REC-002 → REC-005) for one investor's ACTIVE mandate in one context. It
-- is built in status BUILDING, published to CURRENT in one transaction that
-- also supersedes the previous CURRENT slate, and thereafter immutable: an
-- item's rank, score, reasons and feature-snapshot reference never move.
-- Invalidation and expiry change lifecycle columns only; a rebuild is a new
-- slate. History stays interpretable: every version that produced the
-- ordering is on the row, and item rows point at the exact feature snapshot
-- REC-005 ranked.

-- ---------------------------------------------------------------------------
-- Slates.
-- ---------------------------------------------------------------------------

create table recommendation.slates (
  id                            uuid primary key default gen_random_uuid(),
  -- The investor's tenant: the artifact is the investor's own.
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id      uuid not null,
  mandate_id                    uuid not null,
  mandate_version               integer not null check (mandate_version >= 1),
  mode                          text not null check (mode in ('INVESTOR_DISCOVER', 'FOUNDER_DISCOVER', 'GATEQ', 'SEARCH', 'Q_RECOMMENDATION')),
  status                        text not null default 'BUILDING'
                                  check (status in ('BUILDING', 'CURRENT', 'SUPERSEDED', 'INVALIDATED', 'EXPIRED', 'FAILED')),
  -- Every version that produced the ordering, separately.
  eligibility_policy_version    text not null check (eligibility_policy_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  structured_generator_version  text not null check (structured_generator_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  -- Null when the semantic generator degraded for this build (REC-003 UNAVAILABLE).
  semantic_generator_version    text check (semantic_generator_version is null or semantic_generator_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  feature_schema_version        text not null check (feature_schema_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  ranker_version                text not null check (ranker_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  ranking_config_version        text not null check (ranking_config_version ~ '^[a-z][a-z0-9-]*\.[a-z0-9-]+$'),
  taxonomy_version              jsonb check (taxonomy_version is null or jsonb_typeof(taxonomy_version) = 'object'),
  -- sha256 over the semantic inputs of the build: identities, versions and
  -- the ranked items' snapshot fingerprints. Never generated_at, never the id.
  generation_fingerprint        text check (generation_fingerprint is null or generation_fingerprint ~ '^[0-9a-f]{64}$'),
  item_count                    integer not null default 0 check (item_count >= 0),
  -- Bounded counts from the build (candidates, features, ranking). Never text.
  diagnostics                   jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  generated_at                  timestamptz not null default now(),
  published_at                  timestamptz,
  -- Set at publication from the slate policy; a CURRENT slate past it is not served.
  expires_at                    timestamptz,
  invalidated_at                timestamptz,
  invalidation_reason           text check (invalidation_reason is null or invalidation_reason in (
                                  'VISIBILITY_CHANGED', 'MARKETPLACE_DISABLED', 'MANDATE_HARD_CHANGED', 'MANDATE_CLOSED',
                                  'RELATIONSHIP_RESTRICTED', 'SECURITY_RESTRICTION', 'REBUILT', 'MANUAL')),
  superseded_at                 timestamptz,
  supersedes_slate_id           uuid references recommendation.slates (id) on delete set null,
  failure_code                  text check (failure_code is null or failure_code ~ '^[A-Z][A-Z_]{0,63}$'),
  created_at                    timestamptz not null default now(),
  constraint slates_current_is_published
    check (status <> 'CURRENT' or (published_at is not null and expires_at is not null and generation_fingerprint is not null)),
  constraint slates_invalidated_has_reason
    check ((status = 'INVALIDATED') = (invalidated_at is not null and invalidation_reason is not null)),
  constraint slates_superseded_has_time
    check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  constraint slates_failed_has_code
    check ((status = 'FAILED') = (failure_code is not null)),
  unique (id, tenant_id),
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete cascade,
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete cascade
);

comment on table recommendation.slates is
  'Precomputed recommendation slates (doc 19 §62): the persisted, versioned, immutable output of one pipeline run for one investor mandate and context. Derived infrastructure, never company or investor truth, never a relationship or an interest. Server-internal; the browser receives a projection.';
comment on column recommendation.slates.status is
  'BUILDING → CURRENT | FAILED; CURRENT → SUPERSEDED | INVALIDATED | EXPIRED. Terminal states never return to BUILDING or CURRENT; a rebuild is a new slate.';
comment on column recommendation.slates.generation_fingerprint is
  'Deterministic identity of the build inputs and the ranked items. Same inputs, same fingerprint: a refresh that reproduces the CURRENT fingerprint is a no-op.';

-- One CURRENT and one BUILDING slate per investor organisation, mandate and
-- context: a second concurrent build claim fails on insert, a second
-- publication fails on the status flip. Deterministic, not last-writer-wins.
create unique index slates_current_key
  on recommendation.slates (investor_organisation_id, mandate_id, mode)
  where status = 'CURRENT';
create unique index slates_building_key
  on recommendation.slates (investor_organisation_id, mandate_id, mode)
  where status = 'BUILDING';
-- Current lookup and history walk.
create index slates_investor_history_idx
  on recommendation.slates (investor_organisation_id, mode, status, generated_at desc);

-- ---------------------------------------------------------------------------
-- Items. Immutable once written; ordered by rank within a slate.
-- ---------------------------------------------------------------------------

create table recommendation.slate_items (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  slate_id                      uuid not null,
  company_id                    uuid not null,
  company_tenant_id             uuid not null,
  rank                          integer not null check (rank >= 1),
  -- REC-005's internal score in [0, 1], null when unscored. Ordering data,
  -- never a public number.
  internal_score                double precision check (internal_score is null or (internal_score >= 0 and internal_score <= 1)),
  -- REC-005 reason codes; bounded, machine-readable, no prose.
  reason_codes                  text[] not null default '{}'::text[] check (array_length(reason_codes, 1) is null or array_length(reason_codes, 1) <= 32),
  -- The exact feature snapshot REC-005 ranked. Restrict: ordinary snapshot
  -- cleanup must not make a served slate uninterpretable.
  feature_snapshot_id           uuid not null references recommendation.feature_snapshots (id) on delete restrict,
  feature_snapshot_fingerprint  text not null check (feature_snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Generator and representation versions the candidate carried (identities only).
  candidate_provenance          jsonb not null check (jsonb_typeof(candidate_provenance) = 'object'),
  created_at                    timestamptz not null default now(),
  unique (slate_id, rank),
  unique (slate_id, company_id),
  foreign key (slate_id, tenant_id)
    references recommendation.slates (id, tenant_id) on delete cascade,
  -- Restrict, not cascade: recommendation history outlives a company row's
  -- removal until a deliberate retention step decides otherwise.
  foreign key (company_id, company_tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table recommendation.slate_items is
  'One ranked company in one slate (doc 19 §62): rank, internal score, REC-005 reason codes and the exact feature snapshot ranked. Immutable; a company appears at most once per slate; ranks are unique within a slate. Server-internal.';
comment on column recommendation.slate_items.internal_score is
  'REC-005 internal ordering score, [0, 1] or null when unscored. Not a probability, not a quality, never shown to a user.';

-- (slate_id, rank) is the page key and is served by the unique index above.
create index slate_items_company_idx
  on recommendation.slate_items (company_tenant_id, company_id);

-- ---------------------------------------------------------------------------
-- Refresh requests: the claim and coalescing row behind the pgmq queue.
--
-- pgmq delivers durably and retries; it cannot coalesce ten events into one
-- rebuild or tell two workers apart. One row per investor organisation,
-- mandate and context does both: enqueue upserts it PENDING (raising the
-- priority, never lowering it), the worker claims it before building, and
-- a claim that finds it already CLAIMED or DONE for a newer request stands
-- down. Identifiers and bounded codes only; no mandate, no profile, no
-- snapshot.
-- ---------------------------------------------------------------------------

create table recommendation.refresh_requests (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id      uuid not null,
  mandate_id                    uuid not null,
  mode                          text not null check (mode in ('INVESTOR_DISCOVER', 'FOUNDER_DISCOVER', 'GATEQ', 'SEARCH', 'Q_RECOMMENDATION')),
  status                        text not null default 'PENDING' check (status in ('PENDING', 'CLAIMED', 'DONE', 'FAILED')),
  -- HIGH: a material safety change (privacy, hard mandate, marketplace,
  -- block); NORMAL: everything else.
  priority                      text not null default 'NORMAL' check (priority in ('NORMAL', 'HIGH')),
  reason                        text not null check (reason ~ '^[A-Z][A-Z_]{0,63}$'),
  -- Monotonic per row: every enqueue bumps it, a claim records which one it took.
  request_sequence              integer not null default 1 check (request_sequence >= 1),
  claimed_sequence              integer check (claimed_sequence is null or claimed_sequence >= 1),
  attempts                      integer not null default 0 check (attempts >= 0),
  last_error_code               text check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z_]{0,63}$'),
  requested_at                  timestamptz not null default now(),
  claimed_at                    timestamptz,
  completed_at                  timestamptz,
  constraint refresh_requests_claimed_has_time
    check ((status = 'CLAIMED') = (claimed_at is not null and claimed_sequence is not null)),
  unique (investor_organisation_id, mandate_id, mode),
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete cascade,
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete cascade
);

comment on table recommendation.refresh_requests is
  'Coalescing claim row for slate refresh work (doc 19 §148–§151): one per investor organisation, mandate and context; enqueue upserts it, the worker claims it. Identifiers, priority and bounded codes only. Server-internal.';

create index refresh_requests_pending_idx
  on recommendation.refresh_requests (status, priority, requested_at)
  where status = 'PENDING';

-- The durable queue and its dead letter, like `documents`.
select pgmq.create('recommendation-refresh');
select pgmq.create('recommendation-refresh-dead');
revoke all on all functions in schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability and lifecycle.
-- ---------------------------------------------------------------------------

create or replace function recommendation.protect_slate() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.investor_organisation_id is distinct from old.investor_organisation_id
     or new.mandate_id is distinct from old.mandate_id
     or new.mandate_version is distinct from old.mandate_version
     or new.mode is distinct from old.mode
     or new.eligibility_policy_version is distinct from old.eligibility_policy_version
     or new.structured_generator_version is distinct from old.structured_generator_version
     or new.semantic_generator_version is distinct from old.semantic_generator_version
     or new.feature_schema_version is distinct from old.feature_schema_version
     or new.ranker_version is distinct from old.ranker_version
     or new.ranking_config_version is distinct from old.ranking_config_version
     or new.taxonomy_version is distinct from old.taxonomy_version
     or new.generated_at is distinct from old.generated_at then
    raise exception 'a slate''s identity and versions are immutable; a rebuild is a new slate'
      using errcode = 'check_violation';
  end if;
  -- Content set once, at publication, then frozen.
  if old.status <> 'BUILDING' and (
       new.generation_fingerprint is distinct from old.generation_fingerprint
       or new.item_count is distinct from old.item_count
       or new.diagnostics is distinct from old.diagnostics
       or new.published_at is distinct from old.published_at
       or new.expires_at is distinct from old.expires_at) then
    raise exception 'a published slate''s content is immutable'
      using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'BUILDING' and new.status in ('CURRENT', 'FAILED'))
      or (old.status = 'CURRENT' and new.status in ('SUPERSEDED', 'INVALIDATED', 'EXPIRED'))
    ) then
      raise exception 'illegal slate transition % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function recommendation.protect_slate() from public;

create trigger slates_lifecycle
  before update on recommendation.slates
  for each row execute function recommendation.protect_slate();

create or replace function recommendation.protect_slate_item() returns trigger
language plpgsql as $$
begin
  raise exception 'slate items are immutable; a rebuild is a new slate'
    using errcode = 'check_violation';
end;
$$;
revoke all on function recommendation.protect_slate_item() from public;

create trigger slate_items_immutable
  before update on recommendation.slate_items
  for each row execute function recommendation.protect_slate_item();

-- Items may be written only while the slate is BUILDING: a published slate
-- never gains or loses a row.
create or replace function recommendation.require_building_slate() returns trigger
language plpgsql as $$
declare
  current_status text;
begin
  select s.status into current_status from recommendation.slates s where s.id = new.slate_id;
  if current_status is distinct from 'BUILDING' then
    raise exception 'items may only be added to a BUILDING slate'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function recommendation.require_building_slate() from public;

create trigger slate_items_building_only
  before insert on recommendation.slate_items
  for each row execute function recommendation.require_building_slate();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
-- ---------------------------------------------------------------------------

alter table recommendation.slates enable row level security;
alter table recommendation.slate_items enable row level security;
alter table recommendation.refresh_requests enable row level security;
