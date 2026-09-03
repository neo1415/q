-- CQ-COMP-002 · Founder / team domain
--
-- Three narrow tables inside the Company bounded context:
--
--   core.company_members     Person <-> Company relationship (business truth)
--   core.founder_profiles    person-owned, deliberately supplied founder profile
--   core.company_team_facts  self-reported aggregate team composition
--
-- Kept apart, permanently:
--
--   Auth User ≠ Person ≠ Organisation Membership ≠ Company Membership
--   ≠ Founder Profile ≠ Role ≠ Authority
--
-- A company membership never authorises anything: access still requires an
-- active organisation membership (ActorContext) and capabilities; RLS below
-- reads company rows only through the organisation the company belongs to.
-- `is_founder` means "represented as a founder of this company" and nothing
-- more. No fake Person is created for a cofounder who has not joined:
-- team composition lives in aggregate facts.

-- ---------------------------------------------------------------------------
-- core.company_members
-- ---------------------------------------------------------------------------

create table core.company_members (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  company_id         uuid not null,
  -- The canonical Person, never the auth subject.
  user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  -- How the person relates to the company. Not a job title, not authority.
  relationship_type  text not null default 'team_member'
                       check (relationship_type in ('team_member', 'advisor', 'board_member', 'contractor', 'other')),
  -- Professional presentation only. "CEO" grants nothing.
  business_title     text check (business_title is null or length(btrim(business_title)) between 1 and 120),
  -- Represented as a founder. Self-asserted; not verified, not administrative.
  is_founder         boolean not null default false,
  is_current         boolean not null default true,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz check (ended_at is null or ended_at >= started_at),
  version            integer not null default 1 check (version >= 1),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (is_current = (ended_at is null)),
  -- Tenant coherence is relational: the member row can only name a company
  -- under the tenant that owns it.
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table core.company_members is
  'Person <-> Company relationship. Business truth only: never authorisation, never verification. History is kept (is_current = false, ended_at set), never deleted.';
comment on column core.company_members.is_founder is
  'Represented as a founder of this company. Does not imply organisation administrator, company owner, verified founder or any capability.';

-- One current relationship per person per company; ended periods remain.
create unique index company_members_one_current_idx
  on core.company_members (company_id, user_id)
  where is_current;

create index company_members_tenant_company_idx
  on core.company_members (tenant_id, company_id);
create index company_members_company_user_idx
  on core.company_members (company_id, user_id);
create index company_members_user_current_idx
  on core.company_members (user_id, is_current);

create trigger set_updated_at
  before update on core.company_members
  for each row execute function private.set_updated_at();

alter table core.company_members enable row level security;

-- Readable by current members of the organisation that owns the company.
-- The company row itself is RLS-protected, so the subquery can only ever see
-- companies the caller's organisation membership already reaches.
create policy company_members_organisation_select on core.company_members
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = company_id
       and c.tenant_id = tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.company_members to authenticated;

-- ---------------------------------------------------------------------------
-- core.founder_profiles
-- ---------------------------------------------------------------------------

create table core.founder_profiles (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  -- Optional contextual anchor, set on first creation and never moved silently.
  primary_company_id    uuid,
  -- Deliberately supplied narrative. Never Q conversation, never inference.
  professional_summary  text check (professional_summary is null or length(professional_summary) between 1 and 4000),
  background_summary    text check (background_summary is null or length(background_summary) between 1 and 4000),
  -- ADR-001 disclosure vocabulary. Classification metadata, not authorisation;
  -- founder_private by default and not changed by profile edits.
  visibility_scope      text not null default 'founder_private'
                          check (visibility_scope in (
                            'personal_private', 'organisation_private', 'founder_private',
                            'investor_private', 'relationship_shared', 'specifically_shared',
                            'network_visible', 'public_external')),
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- One profile per person per tenant; a person may found several companies.
  unique (tenant_id, user_id),
  foreign key (primary_company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table core.founder_profiles is
  'Person-owned founder profile: deliberately supplied summaries only. Not Q memory, not evidence, not verification, founder_private by default.';

create index founder_profiles_primary_company_idx
  on core.founder_profiles (primary_company_id);

create trigger set_updated_at
  before update on core.founder_profiles
  for each row execute function private.set_updated_at();

alter table core.founder_profiles enable row level security;

-- Conservative baseline: a person reads their own profile. Company and
-- investor projections arrive through deliberate APIs and disclosure rules.
create policy founder_profiles_own_select on core.founder_profiles
  for select to authenticated
  using (user_id = private.current_app_user_id());

grant select on core.founder_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- core.company_team_facts
-- ---------------------------------------------------------------------------

-- Self-reported, explicitly confirmed aggregate team composition, so "three
-- founders, two full-time, eleven people" can be true before every founder
-- has an account. Unknown stays null; it is never zero and never a score.
create table core.company_team_facts (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  company_id                uuid not null unique,
  founder_count             integer check (founder_count is null or founder_count >= 0),
  full_time_founder_count   integer check (full_time_founder_count is null or full_time_founder_count >= 0),
  team_size                 integer check (team_size is null or team_size >= 0),
  version                   integer not null default 1 check (version >= 1),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (full_time_founder_count is null or founder_count is null or full_time_founder_count <= founder_count),
  check (founder_count is null or team_size is null or founder_count <= team_size),
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table core.company_team_facts is
  'Current self-reported team composition. Structured facts after explicit confirmation; not verified, not investor-visible, not a score.';

create index company_team_facts_tenant_company_idx
  on core.company_team_facts (tenant_id, company_id);

create trigger set_updated_at
  before update on core.company_team_facts
  for each row execute function private.set_updated_at();

alter table core.company_team_facts enable row level security;

create policy company_team_facts_organisation_select on core.company_team_facts
  for select to authenticated
  using (exists (
    select 1 from core.companies c
     where c.id = company_id
       and c.tenant_id = tenant_id
       and private.is_organisation_member(c.organisation_id)));

grant select on core.company_team_facts to authenticated;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('company.team.view',      'Read company team relationships and team facts.'),
  ('company.team.self_edit', 'Maintain one''s own company relationship and founder profile.'),
  ('company.team.manage',    'Administer company-wide team facts.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'company.team.view'),
      ('organisation_admin',  'company.team.self_edit'),
      ('organisation_admin',  'company.team.manage'),
      ('organisation_member', 'company.team.view'),
      ('organisation_member', 'company.team.self_edit')
    )
on conflict (role_id, capability_id) do nothing;
