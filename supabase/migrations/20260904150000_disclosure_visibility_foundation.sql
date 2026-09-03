-- CQ-PERM-001 · Disclosure / visibility foundation
--
-- One deterministic answer to "may this information be disclosed to this
-- recipient in this context, at what access level, until when?". The table
-- stores deliberate disclosure state only -- specific shares, relationship
-- shares, network/public visibility for resources without an intrinsic
-- classification. It never duplicates a domain's own visibility column
-- (core.companies.marketplace_visibility, core.founder_profiles
-- .visibility_scope, network.relationship_events.visibility_scope): those
-- stay the baseline and are read through the owning domain's query port.
--
-- Kept apart, permanently (doc 15; ADR-001):
--
--   Authentication ≠ Authorization ≠ Disclosure ≠ Sensitivity
--   ≠ Verification ≠ Data-use policy
--   Q knows ≠ user may know ≠ user may share ≠ Q may execute
--
-- Nothing here is evaluated in SQL: the Permissions bounded context reads
-- these rows as facts and decides in a pure evaluator. Rows are history:
-- revocation sets revoked_at, expiry is a clock comparison, nothing is
-- edited in place and nothing is deleted. Server-internal: RLS enabled, no
-- policies, no client grants -- who-can-see-what is itself confidential.

-- ---------------------------------------------------------------------------
-- permissions.disclosure_policies
-- ---------------------------------------------------------------------------

create table permissions.disclosure_policies (
  id                     uuid primary key default gen_random_uuid(),
  -- The discloser's tenant (the owner's tenant). Recipients may live in
  -- another tenant: a relationship spans two (ADR 0003), and the evaluator
  -- never requires actor tenant = policy tenant.
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  -- Ownership is resolved server-side from the canonical resource, never
  -- accepted from a client. Person ownership (personal_private) is a
  -- Person, not a faked personal organisation (ADR 0004).
  owner_organisation_id  uuid references identity.organisations (id) on delete restrict,
  owner_user_id          uuid references identity.user_profiles (id) on delete restrict,

  -- Bounded resource kind; the application resolver registry is the only
  -- authority on which kinds exist. Never a table name, never a SQL key.
  resource_type          text not null check (resource_type ~ '^[a-z][a-z0-9_]*$' and length(resource_type) <= 64),
  resource_id            uuid not null,

  -- ADR-001 disclosure vocabulary. `public` is not a value.
  scope_type             text not null check (scope_type in (
                           'personal_private', 'organisation_private', 'founder_private',
                           'investor_private', 'relationship_shared', 'specifically_shared',
                           'network_visible', 'public_external')),

  -- Bounded recipient identity. Never an email address, phone or name.
  recipient_type         text check (recipient_type in ('USER', 'MEMBERSHIP', 'ORGANISATION', 'RELATIONSHIP')),
  recipient_id           uuid,

  -- V1 access levels. Capabilities (edit, share, approve) are never here.
  -- `view` is a platform access policy, not DRM: it does not prevent a
  -- screenshot, and no code claims it does.
  access_level           text not null check (access_level in ('view', 'view_download')),

  expires_at             timestamptz,
  created_by_user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  created_at             timestamptz not null default clock_timestamp(),
  -- Revocation is a timestamp, never a delete. Expired ≠ revoked.
  revoked_at             timestamptz,

  -- A policy has a meaningful owner.
  constraint disclosure_policies_owner_present
    check (owner_user_id is not null or owner_organisation_id is not null),
  constraint disclosure_policies_personal_owner
    check (scope_type <> 'personal_private' or owner_user_id is not null),
  -- Recipient columns travel together.
  constraint disclosure_policies_recipient_pair
    check ((recipient_type is null) = (recipient_id is null)),
  -- specifically_shared names an explicit recipient; relationship_shared
  -- names the exact canonical relationship; broad scopes name nobody.
  constraint disclosure_policies_recipient_by_scope
    check (case scope_type
             when 'specifically_shared' then recipient_type is not null
             when 'relationship_shared' then recipient_type = 'RELATIONSHIP'
             else recipient_type is null
           end),
  constraint disclosure_policies_expiry_after_creation
    check (expires_at is null or expires_at > created_at),
  constraint disclosure_policies_revocation_after_creation
    check (revoked_at is null or revoked_at >= created_at),

  -- No two ACTIVE semantically identical grants. Uniqueness over the
  -- validity window [created_at, expires_at) rather than a partial unique
  -- index on revoked_at alone, so an expired-but-unrevoked grant never
  -- blocks a legitimate replacement (§183, option C) while two overlapping
  -- active grants for the same resource/scope/recipient/access are refused.
  -- NULL recipient columns are coalesced so broad-scope duplicates are
  -- caught too (SQL NULL never equals NULL).
  constraint disclosure_policies_one_active_grant exclude using gist (
    resource_type with =,
    resource_id with =,
    scope_type with =,
    coalesce(recipient_type, '') with =,
    coalesce(recipient_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    access_level with =,
    tstzrange(created_at, expires_at, '[)') with &&
  ) where (revoked_at is null)
);

comment on table permissions.disclosure_policies is
  'Deliberate disclosure state: who may receive a resource, in which context, at which access level, until when. Facts only; decided by the Permissions evaluator. Never the baseline classification a domain already owns. Server-only.';
comment on column permissions.disclosure_policies.owner_user_id is
  'Person owner for personal_private and person-owned resources (ADR 0004). Resolved from the canonical resource, never from a client.';
comment on column permissions.disclosure_policies.access_level is
  'view | view_download. view_download satisfies view; view never satisfies download. A platform access policy, not DRM.';
comment on column permissions.disclosure_policies.revoked_at is
  'Set by revocation. Rows are never deleted or edited; a change is revoke + new policy.';

-- Hot path: active policies by resource (revoked filtered by index, expiry
-- by the evaluator's clock). Inspection reads all rows for a resource
-- through the same index.
create index disclosure_policies_resource_idx
  on permissions.disclosure_policies (resource_type, resource_id, revoked_at);
-- Owner inspection ("what has my organisation / have I shared?").
create index disclosure_policies_owner_organisation_idx
  on permissions.disclosure_policies (owner_organisation_id, resource_type, resource_id)
  where owner_organisation_id is not null;
create index disclosure_policies_owner_user_idx
  on permissions.disclosure_policies (owner_user_id, resource_type, resource_id)
  where owner_user_id is not null;
-- Recipient lookups ("what is shared with this organisation/relationship?").
create index disclosure_policies_recipient_idx
  on permissions.disclosure_policies (recipient_type, recipient_id)
  where recipient_id is not null and revoked_at is null;
-- Expiry sweeps / operational reporting; no job is required for correctness.
create index disclosure_policies_expiry_idx
  on permissions.disclosure_policies (expires_at)
  where revoked_at is null and expires_at is not null;
create index disclosure_policies_tenant_idx
  on permissions.disclosure_policies (tenant_id);

alter table permissions.disclosure_policies enable row level security;
-- No policies and no client grants: INTERNAL_SERVER_ONLY. The ACL itself
-- reveals private relationships and sharing patterns.

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('disclosure.manage',  'Create and revoke deliberate disclosure policies for resources the organisation owns.'),
  ('disclosure.inspect', 'Inspect who currently holds disclosure access to resources the organisation owns.')
on conflict (code) do update
  set description = excluded.description;

-- Minimal V1 mapping: organisation administrators manage and inspect
-- disclosure for resources their organisation legitimately owns (exact
-- resource scope at evaluation time). Founder status, business titles and
-- being a recipient grant nothing.
insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin', 'disclosure.manage'),
      ('organisation_admin', 'disclosure.inspect')
    )
on conflict (role_id, capability_id) do nothing;
