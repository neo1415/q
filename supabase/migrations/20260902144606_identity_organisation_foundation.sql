-- CQ-DATA-002 · Identity / organisation foundation
--
-- The first application schema. It persists the concepts the security package
-- already distinguishes in TypeScript and keeps them distinct at the database:
--
--   auth.users                        authentication identity   (AuthUserId)
--   identity.user_profiles            application Person        (UserId)
--   identity.tenants                  isolation boundary        (TenantId)
--   identity.organisations            workspace entity          (OrganisationId)
--   identity.organisation_memberships Person <-> Organisation   (MembershipId)
--   identity.user_active_contexts     persisted current membership
--
-- Person ≠ Organisation ≠ Membership ≠ Title ≠ Role ≠ Capability. Nothing here
-- lets one stand in for another, and no column on these tables is authority.
--
-- Deletion is RESTRICT throughout. Memberships and profiles are history that
-- attribution depends on; closure becomes an explicit workflow later.

create schema if not exists identity;
create schema if not exists private;

comment on schema identity is
  'Capital Q application identity: tenants, persons, organisations, memberships. Server-accessed; not exposed through the Data API.';
comment on schema private is
  'Reviewed helper functions for RLS and integrity. Never add to the Data API schema list; never a home for general-purpose privileged functions.';

-- New schemas carry no PUBLIC privileges by default; stated so the posture is
-- visible in the migration rather than assumed.
revoke all on schema identity from public;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

-- ---------------------------------------------------------------------------
-- identity.tenants
-- ---------------------------------------------------------------------------

create table identity.tenants (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 1 and 200),
  -- Minimal lifecycle. Extend by ALTER when a product workflow needs a state.
  status          text not null default 'active'
                    check (status in ('active', 'suspended', 'closed')),
  -- Extension points only: no residency engine, data policy or billing yet.
  default_region  text,
  data_policy_id  uuid,
  plan_code       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger set_updated_at
  before update on identity.tenants
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- identity.user_profiles  (the canonical application Person)
-- ---------------------------------------------------------------------------

create table identity.user_profiles (
  -- Generated independently of auth.users.id: AuthUserId ≠ UserId.
  id                  uuid primary key default gen_random_uuid(),
  -- RESTRICT: an auth account cannot be deleted out from under organisation
  -- history. Account closure is a product workflow, not a cascade.
  auth_user_id        uuid not null unique
                        references auth.users (id) on delete restrict,
  display_name        text,
  given_name          text,
  family_name         text,
  headline            text,
  avatar_storage_key  text,
  primary_locale      text,
  timezone            text,
  country_code        text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status              text not null default 'active'
                        check (status in ('active', 'suspended', 'closed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table identity.user_profiles is
  'Application-level Person. Never holds password hashes, tokens, MFA secrets or any authentication material; those stay in auth.users.';

create trigger set_updated_at
  before update on identity.user_profiles
  for each row execute function private.set_updated_at();

-- Every authentication identity gets exactly one application profile.
-- SECURITY DEFINER because auth.users inserts run as supabase_auth_admin,
-- which has no privilege on identity.*. The function reads nothing from
-- user-supplied metadata: profile fields are filled in by the application.
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into identity.user_profiles (auth_user_id)
  values (new.id)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Backfill for any auth user that predates this migration. Never overwrites.
insert into identity.user_profiles (auth_user_id)
select u.id from auth.users u
on conflict (auth_user_id) do nothing;

-- ---------------------------------------------------------------------------
-- identity.organisations
-- ---------------------------------------------------------------------------

create table identity.organisations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  -- Describes the organisation. Never mapped to permission: an
  -- investment_firm is not thereby an investor and a company not a founder.
  organisation_type  text not null check (organisation_type in (
                       'company', 'investment_firm', 'accelerator', 'family_office',
                       'syndicate', 'institution', 'advisor', 'other')),
  legal_name         text,
  display_name       text not null check (length(btrim(display_name)) between 1 and 200),
  -- Mutable route/display identity, unique within the tenant. Never a key.
  slug               text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  website_url        text,
  country_code       text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  jurisdiction_code  text,
  status             text not null default 'active'
                       check (status in ('active', 'suspended', 'closed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, slug),
  -- Lets dependants reference (organisation, tenant) as a pair, so a row can
  -- never claim an organisation under a tenant that does not own it.
  unique (id, tenant_id)
);

-- organisations(tenant_id) lookups are served by the (tenant_id, slug) unique
-- index's leading column; no separate index needed.

create trigger set_updated_at
  before update on identity.organisations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- identity.tenant_organisations
-- ---------------------------------------------------------------------------

-- Preserves tenant -> many organisations for enterprise tenants without
-- collapsing the two concepts. V1 has one primary organisation per tenant.
create table identity.tenant_organisations (
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  organisation_id    uuid not null,
  relationship_type  text not null default 'primary'
                       check (relationship_type in ('primary', 'affiliate')),
  created_at         timestamptz not null default now(),
  primary key (tenant_id, organisation_id),
  -- Coherence with organisations.tenant_id is relational, not application code.
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

create index tenant_organisations_organisation_idx
  on identity.tenant_organisations (organisation_id);

-- ---------------------------------------------------------------------------
-- identity.organisation_memberships
-- ---------------------------------------------------------------------------

create table identity.organisation_memberships (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  organisation_id         uuid not null,
  user_id                 uuid not null references identity.user_profiles (id) on delete restrict,
  -- Access requires 'active'. 'left' and 'revoked' rows stay as history.
  membership_status       text not null default 'active'
                            check (membership_status in ('active', 'left', 'revoked')),
  joined_at               timestamptz not null default now(),
  left_at                 timestamptz check (left_at is null or left_at >= joined_at),
  invited_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  -- A job title. Displayed, never evaluated for permission.
  primary_business_title  text,
  -- Extension data only. Nothing in here is ever read as authority.
  metadata                jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(metadata) = 'object'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((membership_status = 'active') = (left_at is null)),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  -- Lets the active-context table bind a membership to its owner.
  unique (id, user_id)
);

comment on column identity.organisation_memberships.metadata is
  'Extension data. Never read metadata.role, metadata.isAdmin or similar as permission; authority comes from membership_roles, role_capabilities and permissions.grants.';

-- One active membership per person per organisation; history may repeat.
create unique index organisation_memberships_one_active_idx
  on identity.organisation_memberships (user_id, organisation_id)
  where membership_status = 'active';

create index organisation_memberships_user_status_idx
  on identity.organisation_memberships (user_id, membership_status);
create index organisation_memberships_organisation_status_idx
  on identity.organisation_memberships (organisation_id, membership_status);
create index organisation_memberships_tenant_status_idx
  on identity.organisation_memberships (tenant_id, membership_status);

create trigger set_updated_at
  before update on identity.organisation_memberships
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- identity.user_active_contexts
-- ---------------------------------------------------------------------------

-- The persisted default organisation context, used only when a request
-- supplies no explicit selector. It references a membership, never an
-- organisation directly, and it is not authority: the membership must still
-- be active at resolution time. A stale row fails closed; cleanup is optional.
create table identity.user_active_contexts (
  user_id        uuid primary key references identity.user_profiles (id) on delete restrict,
  membership_id  uuid not null,
  updated_at     timestamptz not null default now(),
  -- A person can only ever point at their own membership.
  foreign key (membership_id, user_id)
    references identity.organisation_memberships (id, user_id) on delete restrict
);

create index user_active_contexts_membership_idx
  on identity.user_active_contexts (membership_id);
