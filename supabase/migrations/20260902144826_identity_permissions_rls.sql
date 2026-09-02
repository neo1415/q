-- CQ-DATA-002 · Permission persistence, private RLS helpers, grants and RLS
--
-- Capability is the enforcement primitive. Role is a template that expands to
-- capabilities. Explicit grants and denials are policy facts. None of this is
-- evaluated in SQL: AuthorizationService (CQ-SEC-002) reads these facts and
-- decides. RLS below is row isolation -- defence in depth -- not business
-- authorization, and neither replaces the other.

create schema if not exists permissions;
comment on schema permissions is
  'Capability reference data, role templates and explicit grants. Server-accessed; not exposed through the Data API.';
revoke all on schema permissions from public;

-- Range exclusion on (uuid, uuid, tstzrange) needs btree_gist.
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- permissions.capabilities
-- ---------------------------------------------------------------------------

create table permissions.capabilities (
  id           uuid primary key default gen_random_uuid(),
  -- Machine-readable authority identifier. Same format as CapabilitySchema.
  code         text not null unique
                 check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(code) <= 128),
  description  text,
  status       text not null default 'active' check (status in ('active', 'deprecated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger set_updated_at
  before update on permissions.capabilities
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- permissions.roles  (templates, not enforcement)
-- ---------------------------------------------------------------------------

create table permissions.roles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[a-z][a-z0-9_]*$' and length(code) <= 64),
  name         text not null,
  description  text,
  -- The scope a template resolves to at evaluation time, using the actor's
  -- own tenant/organisation. A template never names a concrete organisation.
  scope_type   text not null check (scope_type in ('tenant', 'organisation')),
  status       text not null default 'active' check (status in ('active', 'deprecated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger set_updated_at
  before update on permissions.roles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- permissions.role_capabilities
-- ---------------------------------------------------------------------------

create table permissions.role_capabilities (
  role_id        uuid not null references permissions.roles (id) on delete restrict,
  capability_id  uuid not null references permissions.capabilities (id) on delete restrict,
  effect         text not null check (effect in ('ALLOW', 'DENY')),
  default_scope  jsonb check (default_scope is null or jsonb_typeof(default_scope) = 'object'),
  created_at     timestamptz not null default now(),
  primary key (role_id, capability_id)
);

create index role_capabilities_capability_idx
  on permissions.role_capabilities (capability_id);

-- ---------------------------------------------------------------------------
-- identity.membership_roles  (role assignment history)
-- ---------------------------------------------------------------------------

create table identity.membership_roles (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references identity.organisation_memberships (id) on delete restrict,
  role_id        uuid not null references permissions.roles (id) on delete restrict,
  valid_from     timestamptz not null default now(),
  -- Authority is removed by ending validity, never by deleting the row.
  valid_until    timestamptz check (valid_until is null or valid_until > valid_from),
  created_at     timestamptz not null default now(),
  -- No two assignments of the same role to the same membership may overlap
  -- in time. Stronger than a partial unique index: it also catches two
  -- explicitly bounded windows that intersect.
  constraint membership_roles_no_overlap exclude using gist (
    membership_id with =,
    role_id with =,
    tstzrange(valid_from, valid_until, '[)') with &&
  )
);

create index membership_roles_membership_idx on identity.membership_roles (membership_id);
create index membership_roles_role_idx on identity.membership_roles (role_id);

-- ---------------------------------------------------------------------------
-- permissions.grants  (explicit ALLOW / DENY policy facts)
-- ---------------------------------------------------------------------------

create table permissions.grants (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  principal_type      text not null check (principal_type in
                        ('user', 'membership', 'organisation', 'relationship_party')),
  principal_id        uuid not null,
  capability_id       uuid not null references permissions.capabilities (id) on delete restrict,
  -- Denormalised for querying/inspection. The application adapter verifies
  -- they agree with the parsed scope and fails closed when they do not.
  resource_type       text check (resource_type is null or resource_type ~ '^[a-z][a-z0-9_]*$'),
  resource_id         uuid,
  effect              text not null check (effect in ('ALLOW', 'DENY')),
  -- A ResourceScope (CQ-SEC-002) as JSON. Parsed through ResourceScopeSchema
  -- on every read; malformed scope is never authority.
  scope               jsonb not null check (jsonb_typeof(scope) = 'object'),
  granted_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  valid_from          timestamptz not null default now(),
  valid_until         timestamptz check (valid_until is null or valid_until > valid_from),
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  check ((resource_type is null) = (resource_id is null)),
  -- A grant cannot scope itself into a different tenant than it belongs to.
  check (scope ->> 'tenantId' = tenant_id::text)
);

create index grants_principal_idx
  on permissions.grants (tenant_id, principal_type, principal_id)
  where revoked_at is null;
create index grants_capability_idx
  on permissions.grants (capability_id);
create index grants_resource_idx
  on permissions.grants (resource_type, resource_id)
  where resource_id is not null;

-- ---------------------------------------------------------------------------
-- private RLS helpers
--
-- SECURITY DEFINER so a policy on memberships can consult memberships without
-- recursing through its own policy. Each one: private schema, empty
-- search_path, fully qualified names, EXECUTE only for the policy role. The
-- caller is always derived from auth.uid(); no function takes a user id.
-- ---------------------------------------------------------------------------

create function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from identity.user_profiles p
  where p.auth_user_id = (select auth.uid())
    and p.status = 'active'
$$;

create function private.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from identity.organisation_memberships m
    where m.tenant_id = target_tenant_id
      and m.membership_status = 'active'
      and m.user_id = (select private.current_app_user_id())
  )
$$;

create function private.is_organisation_member(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from identity.organisation_memberships m
    where m.organisation_id = target_organisation_id
      and m.membership_status = 'active'
      and m.user_id = (select private.current_app_user_id())
  )
$$;

revoke all on function private.current_app_user_id() from public;
revoke all on function private.is_tenant_member(uuid) from public;
revoke all on function private.is_organisation_member(uuid) from public;
grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.is_organisation_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- anon: nothing. authenticated: SELECT only, on the tables whose policies
-- below define what "own" means, plus capability/role reference data. No
-- INSERT/UPDATE/DELETE for any client role: every mutation goes through the
-- server application, which is where business authorization lives.
-- permissions.grants and identity.tenant_organisations get no client grant.
-- ---------------------------------------------------------------------------

grant usage on schema identity to authenticated;
grant usage on schema permissions to authenticated;
grant usage on schema private to authenticated;

grant select on identity.user_profiles to authenticated;
grant select on identity.tenants to authenticated;
grant select on identity.organisations to authenticated;
grant select on identity.organisation_memberships to authenticated;
grant select on identity.membership_roles to authenticated;
grant select on identity.user_active_contexts to authenticated;
grant select on permissions.capabilities to authenticated;
grant select on permissions.roles to authenticated;
grant select on permissions.role_capabilities to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table identity.tenants enable row level security;
alter table identity.user_profiles enable row level security;
alter table identity.organisations enable row level security;
alter table identity.tenant_organisations enable row level security;
alter table identity.organisation_memberships enable row level security;
alter table identity.user_active_contexts enable row level security;
alter table identity.membership_roles enable row level security;
alter table permissions.capabilities enable row level security;
alter table permissions.roles enable row level security;
alter table permissions.role_capabilities enable row level security;
alter table permissions.grants enable row level security;

-- A person reads their own profile only. Raw profiles are not a directory;
-- network-visible professional profiles arrive as their own projection.
create policy user_profiles_select_own
  on identity.user_profiles for select to authenticated
  using (auth_user_id = (select auth.uid()));

-- Tenant and organisation rows are visible only through an active membership.
create policy tenants_select_member
  on identity.tenants for select to authenticated
  using (private.is_tenant_member(id));

create policy organisations_select_member
  on identity.organisations for select to authenticated
  using (private.is_organisation_member(id));

-- Own memberships, including historical ones (attribution, not access).
-- Organisation rosters are served by the server under application authorization.
create policy organisation_memberships_select_own
  on identity.organisation_memberships for select to authenticated
  using (user_id = (select private.current_app_user_id()));

create policy membership_roles_select_own
  on identity.membership_roles for select to authenticated
  using (exists (
    select 1 from identity.organisation_memberships m
    where m.id = membership_id
      and m.user_id = (select private.current_app_user_id())
  ));

create policy user_active_contexts_select_own
  on identity.user_active_contexts for select to authenticated
  using (user_id = (select private.current_app_user_id()));

-- Reference data. Reading a capability's name grants nothing.
create policy capabilities_select_reference
  on permissions.capabilities for select to authenticated using (true);
create policy roles_select_reference
  on permissions.roles for select to authenticated using (true);
create policy role_capabilities_select_reference
  on permissions.role_capabilities for select to authenticated using (true);

-- permissions.grants and identity.tenant_organisations: RLS enabled, no
-- policies. Even a future accidental GRANT yields zero rows.
