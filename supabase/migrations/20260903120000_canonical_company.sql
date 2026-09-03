-- CQ-COMP-001 · Canonical company
--
-- One canonical Company per represented business (doc 13 §9.1). Every later
-- surface -- onboarding, evidence, Q, capital objective, discovery, Q Card,
-- GateQ -- references this row; none creates another company truth.
--
-- What this table is not: a founder record (CQ-COMP-002), a capital
-- objective (CQ-CAP-001), an evidence store, a recommendation or fit score,
-- or Q's memory. Company ≠ Organisation: the organisation is the workspace
-- the company belongs to, linked by (organisation_id, tenant_id).

create schema if not exists core;
comment on schema core is
  'Canonical Capital Q business entities. Server-accessed; not exposed through the Data API.';
revoke all on schema core from public;
grant usage on schema core to authenticated;

-- ---------------------------------------------------------------------------
-- core.companies
-- ---------------------------------------------------------------------------

create table core.companies (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references identity.tenants (id) on delete restrict,
  organisation_id             uuid not null,

  canonical_name              text not null check (length(btrim(canonical_name)) between 1 and 200),
  legal_name                  text check (legal_name is null or length(btrim(legal_name)) between 1 and 200),
  -- Route/presentation identity, unique within the tenant. Never a key.
  slug                        text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  website_url                 text check (website_url is null or (length(website_url) <= 2048 and website_url ~* '^https?://')),

  founded_date                date check (founded_date is null or founded_date <= current_date),

  headquarters_country        text check (headquarters_country is null or headquarters_country ~ '^[A-Z]{2}$'),
  headquarters_city           text check (headquarters_city is null or length(btrim(headquarters_city)) between 1 and 120),

  -- Minimal lifecycle. Closure is a later workflow, never a PATCH field.
  company_status              text not null default 'active'
                                check (company_status in ('active', 'closed')),

  -- ADR-001 visibility vocabulary. Platform access ≠ marketplace
  -- participation: a new company is private to its organisation and only a
  -- later permission/readiness workflow may move it. Not user-editable here.
  marketplace_visibility      text not null default 'organisation_private'
                                check (marketplace_visibility in (
                                  'personal_private', 'organisation_private', 'founder_private',
                                  'investor_private', 'relationship_shared', 'specifically_shared',
                                  'network_visible', 'public_external')),
  -- Marketplace readiness is assessed by a later engine. `not_assessed`
  -- means "not currently marketplace eligible" and is the only value this
  -- packet writes; the vocabulary is bounded text so the readiness packet
  -- can extend it without a schema rewrite.
  marketplace_readiness_state text not null default 'not_assessed'
                                check (marketplace_readiness_state ~ '^[a-z][a-z0-9_]*$'
                                   and length(marketplace_readiness_state) <= 64),

  primary_description         text check (primary_description is null or length(primary_description) between 1 and 8000),
  short_description           text check (short_description is null or length(short_description) between 1 and 400),

  -- A storage object key populated by a later media operation. Never an
  -- arbitrary external URL.
  logo_storage_key            text check (logo_storage_key is null or logo_storage_key ~ '^[a-z0-9][a-z0-9/_.-]{0,254}$'),

  -- Opaque bounded stage reference. No PostgreSQL enum: CQ-TAX-001 supplies
  -- the vocabulary later without touching company identity.
  current_stage_code          text check (current_stage_code is null or
                                (current_stage_code ~ '^[a-z][a-z0-9_]*$' and length(current_stage_code) <= 64)),

  version                     integer not null default 1 check (version >= 1),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Tenant/organisation coherence is relational: a company can never claim
  -- an organisation under a tenant that does not own it.
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  unique (tenant_id, slug),
  -- Lets dependants reference (company, tenant) as a pair.
  unique (id, tenant_id)
);

comment on table core.companies is
  'The one canonical Company per represented business. Profile core only: no founder, capital objective, evidence, score or Q state.';
comment on column core.companies.marketplace_visibility is
  'ADR-001 scope. Defaults to organisation_private; changed only by the permission/marketplace workflow, never by profile PATCH.';
comment on column core.companies.marketplace_readiness_state is
  'Readiness engine output. not_assessed = not marketplace eligible. Never a company quality or investment-readiness score.';

-- No UNIQUE(organisation_id): one company per workspace is the common V1
-- shape, not a permanent rule. No global uniqueness on name, legal name or
-- website: those are not identity proof and would cause false merges.

create index companies_organisation_idx
  on core.companies (organisation_id);
create index companies_tenant_organisation_idx
  on core.companies (tenant_id, organisation_id);
-- Future marketplace eligibility path (doc 13 §9): visibility then stage.
create index companies_marketplace_stage_idx
  on core.companies (marketplace_visibility, current_stage_code);

create trigger set_updated_at
  before update on core.companies
  for each row execute function private.set_updated_at();

-- RLS: organisation-private. Reads only for current active members of the
-- owning organisation; no client role may write. Investor/network
-- visibility arrives with the disclosure and marketplace packets.
alter table core.companies enable row level security;

create policy companies_member_select on core.companies
  for select to authenticated
  using (private.is_organisation_member(organisation_id));

grant select on core.companies to authenticated;

-- ---------------------------------------------------------------------------
-- core.company_creation_requests  (server-only idempotency record)
-- ---------------------------------------------------------------------------

create table core.company_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id       uuid not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  company_id            uuid not null,
  tenant_id             uuid not null,
  created_at            timestamptz not null default now(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table core.company_creation_requests is
  'Idempotency record for POST /v1/companies: (person, organisation, key hash) -> the company created. Hashes only; written in the creation transaction; server-only.';

create index company_creation_requests_company_idx
  on core.company_creation_requests (company_id);

alter table core.company_creation_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('company.create', 'Create the canonical company for the active organisation.'),
  ('company.view',   'Read the organisation-private canonical company profile.'),
  ('company.edit',   'Edit the canonical company profile.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'company.create'),
      ('organisation_admin',  'company.view'),
      ('organisation_admin',  'company.edit'),
      ('organisation_member', 'company.view')
    )
on conflict (role_id, capability_id) do nothing;
