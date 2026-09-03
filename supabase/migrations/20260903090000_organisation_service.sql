-- CQ-ORG-001 · Organisation service
--
-- Turns the CQ-DATA-002 organisation tables into an operated domain. Three
-- narrow forward changes, nothing rewritten:
--
--   1. identity.organisations.version -- optimistic concurrency for the
--      organisation profile (doc 22: mutable resources are versioned).
--   2. Production reference data -- the role templates and capabilities the
--      organisation domain depends on at runtime. Until now they existed only
--      in supabase/seed.sql, which never runs against a deployed database.
--   3. identity.organisation_creation_requests -- durable idempotency state
--      for POST /v1/organisations, written in the same transaction as the
--      workspace it records. No shared HTTP idempotency store exists yet;
--      this table is deliberately narrow and owned by the organisation domain.
--
-- Plus one partial index for the "my organisations" cursor query.

-- ---------------------------------------------------------------------------
-- 1. Organisation profile version
-- ---------------------------------------------------------------------------

alter table identity.organisations
  add column version integer not null default 1 check (version >= 1);

comment on column identity.organisations.version is
  'Optimistic-concurrency version of the profile. Incremented by every profile update; a writer must present the version it read.';

-- ---------------------------------------------------------------------------
-- 2. Production reference data (idempotent by stable code)
--
-- The same rows the local seed installs, so a deployed database is never
-- missing the authority data a running service requires. Adding
-- `organisation.view`: the first real protected organisation read exists now.
-- The detailed product role matrix stays unresolved (Final System Review);
-- only the two minimal templates are mapped.
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('organisation.view',        'View the organisation profile and membership context.'),
  ('organisation.admin',       'Administer the organisation: members, roles and settings.'),
  ('company.financials.view',  'View company financial data.'),
  ('company.financials.edit',  'Edit company financial data.'),
  ('data_room.share',          'Share data room content with another party.'),
  ('q.action.approve',         'Approve a consequential action proposed by Q.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.roles (code, name, description, scope_type) values
  ('organisation_admin',  'Organisation administrator',
     'Administers the organisation it is assigned within.', 'organisation'),
  ('organisation_member', 'Organisation member',
     'Baseline membership template: may view the organisation it belongs to.', 'organisation')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      scope_type = excluded.scope_type;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'organisation.view'),
      ('organisation_admin',  'organisation.admin'),
      ('organisation_member', 'organisation.view')
    )
on conflict (role_id, capability_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Organisation creation idempotency
--
-- One row per (person, Idempotency-Key). Only hashes are stored: the raw key
-- is client-chosen and never persisted. The row points at the organisation
-- it produced through the (id, tenant_id) pair, so it can never name an
-- organisation under the wrong tenant. Server-only: no client role holds any
-- privilege, and RLS is enabled with no policies as the second layer.
-- ---------------------------------------------------------------------------

create table identity.organisation_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  organisation_id       uuid not null,
  tenant_id             uuid not null,
  created_at            timestamptz not null default now(),
  primary key (user_id, idempotency_key_hash),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table identity.organisation_creation_requests is
  'Idempotency record for POST /v1/organisations: (person, key hash) -> the organisation created. Hashes only; written in the creation transaction; server-only.';

create index organisation_creation_requests_organisation_idx
  on identity.organisation_creation_requests (organisation_id);

alter table identity.organisation_creation_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 4. "My organisations" list: active memberships in (joined_at, id) order
-- ---------------------------------------------------------------------------

create index organisation_memberships_user_active_joined_idx
  on identity.organisation_memberships (user_id, joined_at, id)
  where membership_status = 'active';
