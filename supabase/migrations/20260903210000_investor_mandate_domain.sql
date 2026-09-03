-- CQ-INV-002 · Declared investor mandate
--
-- What an Investor Organisation explicitly says it is looking for (doc 13
-- §13.1 / §13.2): a versioned mandate row with cheque and stage envelopes,
-- discovery mode and private narrative, plus typed structured constraints
-- (stage, geography, sector, business and founder attributes, green and red
-- flags, investment role, typical cheque, bounded custom text).
--
-- Kept apart, permanently:
--
--   Declared Mandate ≠ Observed Behaviour ≠ Q Inference ≠ GateQ ≠ Deployment State
--
-- Nothing here is learned from browsing, inferred by Q, or an inbound
-- (GateQ) policy. A soft AVOID is never a HARD_EXCLUSION. Constraint values
-- are typed data, never executable rules. One investor organisation may
-- hold several mandates; there is deliberately no UNIQUE(investor_organisation_id).

-- ---------------------------------------------------------------------------
-- core.investor_mandates
-- ---------------------------------------------------------------------------

create table core.investor_mandates (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null,

  -- Human-readable strategy label. Not identity.
  name                      text not null check (length(btrim(name)) between 1 and 120),

  -- Deliberately small lifecycle. CLOSED rows stay as history.
  status                    text not null default 'DRAFT'
                              check (status in ('DRAFT', 'ACTIVE', 'CLOSED')),
  effective_from            timestamptz,
  effective_to              timestamptz,

  -- STRICT / BALANCED / EXPLORATORY. NULL = not yet chosen. Never GateQ.
  discovery_mode            text check (discovery_mode is null or discovery_mode in ('STRICT', 'BALANCED', 'EXPLORATORY')),

  -- Exact money. Unknown stays NULL, never zero. Typical cheque is a
  -- cheque.typical constraint, not a column (doc 13 defines min/max only).
  min_cheque                numeric check (min_cheque is null or min_cheque >= 0),
  max_cheque                numeric check (max_cheque is null or max_cheque >= 0),
  currency_code             text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),

  -- Bounded stage envelope; CQ-TAX-001 supplies the vocabulary later.
  min_stage_code            text check (min_stage_code is null or (min_stage_code ~ '^[a-z][a-z0-9_]*$' and length(min_stage_code) <= 64)),
  max_stage_code            text check (max_stage_code is null or (max_stage_code ~ '^[a-z][a-z0-9_]*$' and length(max_stage_code) <= 64)),

  -- Investor-private declared narrative. Never structured policy, never
  -- extracted here, never in events, audit or logs.
  raw_mandate_text          text check (raw_mandate_text is null or length(raw_mandate_text) between 1 and 8192),

  created_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  version                   integer not null default 1 check (version >= 1),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  check (min_cheque is null or max_cheque is null or min_cheque <= max_cheque),
  check ((min_cheque is null and max_cheque is null) or currency_code is not null),
  check (status <> 'ACTIVE' or effective_from is not null),
  check (status <> 'CLOSED' or effective_to is not null),
  check (effective_from is null or effective_to is null or effective_to >= effective_from),

  -- Tenant coherence is relational: a mandate can only name an investor
  -- organisation under the tenant that owns it.
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table core.investor_mandates is
  'Declared investor mandate: explicit policy of an investor organisation. Not behaviour, not Q inference, not GateQ. Versioned; CLOSED rows are history, never deleted.';
comment on column core.investor_mandates.raw_mandate_text is
  'Investor-private narrative context. Does not override structured constraints; never emitted in events, audit or logs.';
comment on column core.investor_mandates.discovery_mode is
  'How far discovery may stray from the mandate. No mode bypasses a hard exclusion. Not GateQ inbound policy.';

create index investor_mandates_investor_status_idx
  on core.investor_mandates (investor_organisation_id, status);
create index investor_mandates_tenant_investor_idx
  on core.investor_mandates (tenant_id, investor_organisation_id);
create index investor_mandates_investor_created_idx
  on core.investor_mandates (investor_organisation_id, created_at desc, id desc);

create trigger set_updated_at
  before update on core.investor_mandates
  for each row execute function private.set_updated_at();

alter table core.investor_mandates enable row level security;

-- Readable by current active members of the organisation behind the
-- investor organisation. No client role writes. Founders, other investors
-- and anonymous callers see nothing; a founder-facing projection is a
-- later, deliberate contract.
create policy investor_mandates_member_select on core.investor_mandates
  for select to authenticated
  using (exists (
    select 1 from core.investor_organisations i
     where i.id = core.investor_mandates.investor_organisation_id
       and i.tenant_id = core.investor_mandates.tenant_id
       and private.is_organisation_member(i.organisation_id)));

grant select on core.investor_mandates to authenticated;

-- ---------------------------------------------------------------------------
-- core.investor_mandate_constraints
-- ---------------------------------------------------------------------------

create table core.investor_mandate_constraints (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  mandate_id         uuid not null,
  -- Closed V1 allowlist of investment-relevant dimensions. No protected or
  -- sensitive personal characteristic can be expressed.
  dimension          text not null check (dimension in (
                       'stage', 'geography.country', 'sector', 'business.attribute',
                       'founder.business_attribute', 'green_flag', 'red_flag',
                       'investment_role', 'cheque.typical', 'custom.text')),
  operator           text not null check (operator in ('EQ', 'NEQ', 'IN', 'NOT_IN', 'GTE', 'LTE', 'BETWEEN')),
  -- Typed value object ({kind: codes|amount|text, ...}). Data, never code.
  value_jsonb        jsonb not null check (jsonb_typeof(value_jsonb) = 'object' and length(value_jsonb::text) <= 8192),
  importance         text not null check (importance in ('MUST', 'STRONG', 'NICE', 'NEUTRAL', 'AVOID', 'HARD_EXCLUSION')),
  is_hard_exclusion  boolean not null default false,
  created_at         timestamptz not null default now(),
  -- The two representations of a hard exclusion can never disagree.
  check ((importance = 'HARD_EXCLUSION') = is_hard_exclusion),
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete restrict
);

comment on table core.investor_mandate_constraints is
  'Typed declared constraints of a mandate. importance AVOID is a soft negative; HARD_EXCLUSION (and only it) makes candidates ineligible. value_jsonb is typed data with no expression semantics.';

-- Both indexes serve mandate_id lookups; a bare (mandate_id) index would be redundant.
create index investor_mandate_constraints_mandate_dimension_idx
  on core.investor_mandate_constraints (mandate_id, dimension);
create index investor_mandate_constraints_mandate_hard_idx
  on core.investor_mandate_constraints (mandate_id, is_hard_exclusion);

alter table core.investor_mandate_constraints enable row level security;

create policy investor_mandate_constraints_member_select on core.investor_mandate_constraints
  for select to authenticated
  using (exists (
    select 1
      from core.investor_mandates m
      join core.investor_organisations i
        on i.id = m.investor_organisation_id and i.tenant_id = m.tenant_id
     where m.id = core.investor_mandate_constraints.mandate_id
       and m.tenant_id = core.investor_mandate_constraints.tenant_id
       and private.is_organisation_member(i.organisation_id)));

grant select on core.investor_mandate_constraints to authenticated;

-- ---------------------------------------------------------------------------
-- core.investor_mandate_creation_requests  (server-only idempotency record)
-- ---------------------------------------------------------------------------

create table core.investor_mandate_creation_requests (
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  investor_organisation_id  uuid not null,
  idempotency_key_hash      text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash              text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  mandate_id                uuid not null,
  tenant_id                 uuid not null,
  created_at                timestamptz not null default now(),
  primary key (user_id, investor_organisation_id, idempotency_key_hash),
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete restrict,
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete restrict
);

comment on table core.investor_mandate_creation_requests is
  'Idempotency record for POST /v1/investors/:id/mandates: (person, investor organisation, key hash) -> the mandate created. Hashes only; server-only.';

create index investor_mandate_creation_requests_mandate_idx
  on core.investor_mandate_creation_requests (mandate_id);

alter table core.investor_mandate_creation_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('investor.mandate.create', 'Create a declared mandate for the investor organisation.'),
  ('investor.mandate.view',   'Read the investor organisation''s declared mandates.'),
  ('investor.mandate.edit',   'Edit, activate and close the investor organisation''s declared mandates.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'investor.mandate.create'),
      ('organisation_admin',  'investor.mandate.view'),
      ('organisation_admin',  'investor.mandate.edit'),
      ('organisation_member', 'investor.mandate.view')
    )
on conflict (role_id, capability_id) do nothing;
