-- CQ-CAP-001 · Canonical capital objective
--
-- The company's authoritative capital goal (doc 13 §14): what it is
-- raising, how much, in which currency, at which stage, with which
-- instrument where applicable, by when, for what, and whether the goal is
-- still active or how it ended. Founder onboarding, Q, InvestIQ, Blueprint,
-- recommendations, Discover and relationships all reference this row; none
-- keeps a competing raise truth.
--
-- Kept apart, permanently:
--
--   Company ≠ Capital Objective ≠ Readiness ≠ Fundraising Progress
--   ≠ Investment Outcome ≠ Company Stage ≠ Instrument ≠ Q Inference
--
-- A company may pursue many objectives over time but holds at most one
-- ACTIVE objective (partial unique index). Terminal objectives are history:
-- never deleted, never edited. Closing below target is not failure; the
-- vocabulary has no FAILED or COMPLETED. Money is exact numeric.
--
-- instrument_code is an implementation clarification required by doc 25 /
-- founder onboarding F6 ("stage / instrument where applicable") and is
-- recorded in docs/adr/0002-capital-objective-instrument-code.md.

-- ---------------------------------------------------------------------------
-- core.capital_objectives
-- ---------------------------------------------------------------------------

create table core.capital_objectives (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  company_id            uuid not null,

  -- V1: the company raise. Kept as a column so the objective can evolve;
  -- never overloaded with instrument semantics.
  objective_type        text not null default 'RAISE' check (objective_type in ('RAISE')),

  -- ACTIVE, or the reason the objective ended. No generic failure state.
  status                text not null default 'ACTIVE'
                          check (status in ('ACTIVE', 'ACHIEVED', 'CLOSED_BY_FOUNDER', 'DISCONTINUED', 'REPLACED')),

  -- Exact money. A promoted RAISE objective always has a positive target
  -- and its currency; unknown intent stays in onboarding, never becomes 0.
  target_amount         numeric not null check (target_amount > 0),
  currency_code         text not null check (currency_code ~ '^[A-Z]{3}$'),

  -- Bounded stage code, separate from core.companies.current_stage_code.
  target_stage          text check (target_stage is null or (target_stage ~ '^[a-z][a-z0-9_]*$' and length(target_stage) <= 64)),
  -- Financing instrument (SAFE, priced equity, convertible, ...). Separate
  -- from stage and from objective type. Bounded code until taxonomy.
  instrument_code       text check (instrument_code is null or instrument_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  -- A planning date, never a punitive deadline. Passing it changes nothing.
  target_close_date     date,

  -- Bounded founder-provided context. Not evidence, not a budget.
  use_of_funds_summary  text check (use_of_funds_summary is null or length(use_of_funds_summary) between 1 and 2000),

  started_at            timestamptz not null default now(),
  closed_at             timestamptz,
  created_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check ((status = 'ACTIVE') = (closed_at is null)),
  check (closed_at is null or closed_at >= started_at),

  -- Tenant coherence is relational: an objective can only name a company
  -- under the tenant that owns it.
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table core.capital_objectives is
  'The company''s canonical capital objective. Goal state only: no readiness, progress, commitments, valuation or outcome. At most one ACTIVE per company; terminal rows are immutable history.';
comment on column core.capital_objectives.status is
  'ACTIVE or the reason the objective ended. Closing below target is a commercial decision, never FAILED.';
comment on column core.capital_objectives.instrument_code is
  'Financing instrument where applicable (ADR 0002). Distinct from target_stage and objective_type.';
comment on column core.capital_objectives.target_close_date is
  'Planning date. Passing it does not close the objective, mark anyone behind or affect ranking.';

-- One current objective per company; history is unlimited.
create unique index capital_objectives_one_active_idx
  on core.capital_objectives (company_id)
  where status = 'ACTIVE';

create index capital_objectives_tenant_company_idx
  on core.capital_objectives (tenant_id, company_id);
create index capital_objectives_company_status_idx
  on core.capital_objectives (company_id, status);
create index capital_objectives_company_created_idx
  on core.capital_objectives (company_id, created_at desc, id desc);

create trigger set_updated_at
  before update on core.capital_objectives
  for each row execute function private.set_updated_at();

alter table core.capital_objectives enable row level security;

-- Company/organisation-private. Readable by current active members of the
-- organisation that owns the company; no client role writes. Investor and
-- network visibility arrive with CQ-PERM-001 as a disclosure-safe projection.
create policy capital_objectives_member_select on core.capital_objectives
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = core.capital_objectives.company_id
       and c.tenant_id = core.capital_objectives.tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.capital_objectives to authenticated;

-- ---------------------------------------------------------------------------
-- core.capital_objective_events  (goal-evolution history)
-- ---------------------------------------------------------------------------

-- Business history of how the objective evolved, so "what changed and from
-- what" can be reconstructed. Distinct from audit (who acted under whose
-- authority), from events.outbox (integration messages carrying ids and
-- change kinds only) and from analytics. Append-only.
create table core.capital_objective_events (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  capital_objective_id  uuid not null,
  event_type            text not null check (event_type in ('CREATED', 'RECALIBRATED', 'CLOSED', 'REPLACED')),
  -- clock_timestamp(), not now(): several history rows may be appended in
  -- one transaction (replacement writes two) and their order must be real.
  occurred_at           timestamptz not null default clock_timestamp(),
  actor_type            text not null check (actor_type ~ '^[A-Z][A-Z_]{0,31}$'),
  actor_id              uuid not null,
  -- Typed, bounded canonical values (previous/next, reason, replacement id).
  -- Never Q text, documents, notes or relationship data.
  payload               jsonb not null check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 8192),
  foreign key (capital_objective_id, tenant_id)
    references core.capital_objectives (id, tenant_id) on delete restrict
);

comment on table core.capital_objective_events is
  'Append-only goal-evolution history of a capital objective (CREATED, RECALIBRATED, CLOSED, REPLACED) with bounded typed payloads. Not audit, not outbox, not analytics.';

create index capital_objective_events_objective_time_idx
  on core.capital_objective_events (capital_objective_id, occurred_at);
create index capital_objective_events_tenant_objective_time_idx
  on core.capital_objective_events (tenant_id, capital_objective_id, occurred_at);

alter table core.capital_objective_events enable row level security;

create policy capital_objective_events_member_select on core.capital_objective_events
  for select to authenticated
  using (exists (
    select 1
      from core.capital_objectives o
      join core.companies c on c.id = o.company_id and c.tenant_id = o.tenant_id
     where o.id = core.capital_objective_events.capital_objective_id
       and o.tenant_id = core.capital_objective_events.tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.capital_objective_events to authenticated;

-- ---------------------------------------------------------------------------
-- core.capital_objective_creation_requests  (server-only idempotency record)
-- ---------------------------------------------------------------------------

create table core.capital_objective_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  company_id            uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  capital_objective_id  uuid not null,
  tenant_id             uuid not null,
  created_at            timestamptz not null default now(),
  primary key (user_id, company_id, idempotency_key_hash),
  foreign key (capital_objective_id, tenant_id)
    references core.capital_objectives (id, tenant_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table core.capital_objective_creation_requests is
  'Idempotency record for POST /v1/companies/:id/capital-objectives: (person, company, key hash) -> the objective created. Hashes only; server-only.';

create index capital_objective_creation_requests_objective_idx
  on core.capital_objective_creation_requests (capital_objective_id);

alter table core.capital_objective_creation_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('capital_objective.create', 'Create the company''s capital objective.'),
  ('capital_objective.view',   'Read the company''s capital objectives and their history.'),
  ('capital_objective.edit',   'Recalibrate the company''s active capital objective.'),
  ('capital_objective.close',  'Close or replace the company''s active capital objective.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'capital_objective.create'),
      ('organisation_admin',  'capital_objective.view'),
      ('organisation_admin',  'capital_objective.edit'),
      ('organisation_admin',  'capital_objective.close'),
      ('organisation_member', 'capital_objective.view')
    )
on conflict (role_id, capability_id) do nothing;
