-- CQ-INV-001 · Canonical investor organisation
--
-- One canonical Investor Organisation per represented capital provider
-- (doc 13 §12.1) and the representative linkage that records, attributably,
-- which people participate in it (§12.3). Five partners of one fund are one
-- investor organisation, five persons, five memberships and up to five
-- representative rows -- never five copies of the fund.
--
-- Kept apart, permanently:
--
--   Person ≠ Organisation ≠ Organisation Membership ≠ Investor Organisation
--   ≠ Investor Representative ≠ Investment Fund ≠ Mandate ≠ Authority
--
-- identity.organisations stays the institutional identity ("Organisation is
-- primary identity"); the investor row is that organisation's investing
-- profile, linked by organisation_id and unique per organisation. Nothing
-- here is a mandate (cheque, stage, sector, geography, exclusions,
-- discovery mode -- CQ-INV-002), observed behaviour, Q inference, GateQ
-- state or a reputation score. A representative row grants nothing: access
-- still requires an active organisation membership and capabilities.

-- ---------------------------------------------------------------------------
-- identity.organisation_memberships: relational coherence support
-- ---------------------------------------------------------------------------

-- Lets a dependant bind (membership, person, organisation, tenant) as one
-- reference, so a representative row can never pair a person with someone
-- else's membership or a membership from another organisation or tenant.
-- Additive only; the existing (id, user_id) key remains.
alter table identity.organisation_memberships
  add constraint organisation_memberships_id_user_org_tenant_key
  unique (id, user_id, organisation_id, tenant_id);

-- ---------------------------------------------------------------------------
-- core.investor_organisations
-- ---------------------------------------------------------------------------

create table core.investor_organisations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  -- The underlying institutional workspace. Exactly one investor identity
  -- per organisation; the organisation is never the investor id.
  organisation_id     uuid not null unique,

  -- Bounded V1 vocabulary. Describes; never grants. Deliberately not the
  -- organisation_type of identity.organisations and not a Postgres enum.
  investor_type       text not null
                        check (investor_type in (
                          'ANGEL', 'VC', 'FAMILY_OFFICE', 'CVC', 'SYNDICATE',
                          'ACCELERATOR', 'SCOUT', 'INSTITUTIONAL', 'OTHER')),

  -- Investor-profile presentation fields (doc 13 §12.1). Defaulted from
  -- the organisation at creation; edits here never flow back to it.
  display_name        text not null check (length(btrim(display_name)) between 1 and 200),
  website_url         text check (website_url is null or (length(website_url) <= 2048 and website_url ~* '^https?://')),
  -- Headquarters context only. Not mandate geography.
  hq_country          text check (hq_country is null or hq_country ~ '^[A-Z]{2}$'),
  -- Content intended for a future profile projection. Organisation-private
  -- until CQ-PERM-001 decides disclosure; the name does not make it public.
  public_description  text check (public_description is null or length(public_description) between 1 and 4000),

  -- Coarse identity-verification presentation state, owned by the future
  -- verification subsystem. Never investment authority, affiliation proof
  -- or trust. Bounded text so that subsystem can extend the vocabulary.
  verification_state  text not null default 'unverified'
                        check (verification_state ~ '^[a-z][a-z0-9_]*$'
                           and length(verification_state) <= 64),

  -- Current high-level availability to deploy capital (onboarding I1).
  -- NULL is "not yet answered" and stays unknown: it is never read as
  -- paused or active. Not a mandate status, not GateQ, not reputation.
  deployment_state    text check (deployment_state is null or deployment_state in (
                          'ACTIVELY_INVESTING', 'SELECTIVE', 'PAUSED', 'EXPLORING_ONLY')),

  version             integer not null default 1 check (version >= 1),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Tenant/organisation coherence is relational.
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  unique (id, tenant_id),
  -- Lets representatives bind (investor, organisation, tenant) as one reference.
  unique (id, organisation_id, tenant_id)
);

comment on table core.investor_organisations is
  'The one canonical Investor Organisation per organisation. Investing profile and deployment state only: no mandate, fund, behaviour, inference, GateQ state, verification claim or score.';
comment on column core.investor_organisations.deployment_state is
  'Availability to deploy capital. NULL = unknown (never paused, never active). Separate from mandate status and GateQ; never a reputation or quality signal.';
comment on column core.investor_organisations.verification_state is
  'Coarse presentation state owned by the verification subsystem. Not writable through profile updates; establishes no authority.';
comment on column core.investor_organisations.public_description is
  'Profile text for a future projection. Organisation-private until a disclosure rule says otherwise; not an investment thesis (that is the mandate).';

-- The UNIQUE on organisation_id already serves "investor for the active
-- organisation"; a further (tenant_id, organisation_id) index would be
-- redundant on this small table.
create index investor_organisations_tenant_deployment_idx
  on core.investor_organisations (tenant_id, deployment_state);
create index investor_organisations_type_idx
  on core.investor_organisations (investor_type);

create trigger set_updated_at
  before update on core.investor_organisations
  for each row execute function private.set_updated_at();

alter table core.investor_organisations enable row level security;

-- Organisation-internal read for current active members of the underlying
-- organisation. No client role writes; nothing is network or public
-- visible yet, whatever a column is called.
create policy investor_organisations_member_select on core.investor_organisations
  for select to authenticated
  using (private.is_organisation_member(organisation_id));

grant select on core.investor_organisations to authenticated;

-- ---------------------------------------------------------------------------
-- core.investor_representatives
-- ---------------------------------------------------------------------------

create table core.investor_representatives (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null,
  -- Denormalised from the investor organisation so the membership reference
  -- can be proven to belong to the same organisation relationally.
  organisation_id           uuid not null,
  -- The canonical Person, never the auth subject.
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  -- The capacity in which the person represents the investor.
  membership_id             uuid not null,
  -- Professional presentation only. "Managing Partner" grants nothing.
  business_title            text check (business_title is null or length(btrim(business_title)) between 1 and 120),
  is_current                boolean not null default true,
  started_at                timestamptz not null default now(),
  ended_at                  timestamptz check (ended_at is null or ended_at >= started_at),
  version                   integer not null default 1 check (version >= 1),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (is_current = (ended_at is null)),
  -- Investor, organisation and tenant cannot drift apart.
  foreign key (investor_organisation_id, organisation_id, tenant_id)
    references core.investor_organisations (id, organisation_id, tenant_id) on delete restrict,
  -- Representative.user_id = Membership.user_id, Membership.organisation_id =
  -- InvestorOrganisation.organisation_id, and the same tenant -- one reference.
  foreign key (membership_id, user_id, organisation_id, tenant_id)
    references identity.organisation_memberships (id, user_id, organisation_id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table core.investor_representatives is
  'Person <-> Investor Organisation representation, in the capacity of a real organisation membership. Attribution only: never authority, never continuing access. History is kept (is_current = false), never deleted.';
comment on column core.investor_representatives.business_title is
  'Presentation. Never evaluated for permission.';

-- One current representation per investor organisation and person; ended
-- periods remain as history.
create unique index investor_representatives_one_current_idx
  on core.investor_representatives (investor_organisation_id, user_id)
  where is_current;

create index investor_representatives_tenant_investor_idx
  on core.investor_representatives (tenant_id, investor_organisation_id);
create index investor_representatives_investor_user_idx
  on core.investor_representatives (investor_organisation_id, user_id);
create index investor_representatives_membership_idx
  on core.investor_representatives (membership_id);

create trigger set_updated_at
  before update on core.investor_representatives
  for each row execute function private.set_updated_at();

alter table core.investor_representatives enable row level security;

-- Conservative V1: a person reads their own representation, and only while
-- they are still an active member of the organisation. A representative
-- row that outlives the membership is history, not access. Directories of
-- representatives arrive with deliberate profile projections.
create policy investor_representatives_own_select on core.investor_representatives
  for select to authenticated
  using (user_id = private.current_app_user_id()
     and private.is_organisation_member(organisation_id));

grant select on core.investor_representatives to authenticated;

-- ---------------------------------------------------------------------------
-- core.investor_creation_requests  (server-only idempotency record)
-- ---------------------------------------------------------------------------

create table core.investor_creation_requests (
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id           uuid not null,
  idempotency_key_hash      text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash              text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  investor_organisation_id  uuid not null,
  tenant_id                 uuid not null,
  created_at                timestamptz not null default now(),
  primary key (user_id, organisation_id, idempotency_key_hash),
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete restrict,
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table core.investor_creation_requests is
  'Idempotency record for POST /v1/investors: (person, organisation, key hash) -> the investor organisation created. Hashes only; written in the creation transaction; server-only.';

create index investor_creation_requests_investor_idx
  on core.investor_creation_requests (investor_organisation_id);

alter table core.investor_creation_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('investor.create',                  'Establish the canonical investor organisation for the active organisation.'),
  ('investor.view',                    'Read the organisation-internal investor organisation profile.'),
  ('investor.edit',                    'Edit the investor organisation profile and deployment state.'),
  ('investor.representative.self_edit', 'Maintain one''s own representation of the investor organisation.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'investor.create'),
      ('organisation_admin',  'investor.view'),
      ('organisation_admin',  'investor.edit'),
      ('organisation_admin',  'investor.representative.self_edit'),
      ('organisation_member', 'investor.view'),
      ('organisation_member', 'investor.representative.self_edit')
    )
on conflict (role_id, capability_id) do nothing;
