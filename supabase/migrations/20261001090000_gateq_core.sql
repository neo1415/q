-- CQ-GATE-001 · gateq.gateways, gateway_versions and gateway_criteria: an
-- investor organisation's versioned, published inbound policy (doc 11,
-- doc 13; GateQ supplementary spec).
--
--   gateway mode ≠ qualification outcome ≠ access decision
--   GateQ published policy ≠ investor mandate
--   qualified ≠ good company ≠ investment-ready ≠ recommended
--   unknown ≠ no match
--
-- A gateway is the organisation's front door. It answers one question --
-- does this application satisfy the policy this organisation published --
-- and nothing it stores is a score, a ranking input or a relationship.
--
-- Three tables, and the versioning is the point. Publishing changes who may
-- approach an organisation, so it is an explicit act with an author and a
-- time, a draft never moves the public door, and a historical qualification
-- stays attributable to the exact policy row that produced it. That is why
-- a version is a row rather than a column somebody overwrites.

create schema if not exists gateq;

-- ---------------------------------------------------------------------------
-- Gateways: identity and the public handle.
-- ---------------------------------------------------------------------------

create table gateq.gateways (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  -- The owning investor organisation, and the identity workspace behind it.
  -- Authority is read from here, never from a request body.
  investor_organisation_id  uuid not null references core.investor_organisations (id) on delete restrict,
  organisation_id           uuid not null,

  -- The opaque public handle (§4, §19). Unguessable on purpose: a
  -- sequential id or a name-derived slug would let anyone enumerate which
  -- investors are open to inbound, which is a competitive fact nobody
  -- agreed to publish. It grants nothing on its own.
  public_id                 text not null unique
                              check (public_id ~ '^gq_[0-9a-hjkmnp-tv-z]{26}$'),

  name                      text not null check (length(btrim(name)) between 1 and 160),

  -- Whether the organisation still operates this door at all. Distinct from
  -- inbound mode, which is a property of the published version.
  status                    text not null default 'ACTIVE'
                              check (status in ('ACTIVE', 'DISABLED')),

  -- Provenance only. A gateway belongs to the organisation; the person who
  -- set it up has no standing authority over it and may have left.
  created_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table gateq.gateways is
  'An investor organisation''s inbound gateway. One organisation may hold several -- a fund, a programme, an accelerator cohort -- so nothing here assumes a single front door.';
comment on column gateq.gateways.public_id is
  'Opaque public handle for links, embeds and QR codes. Grants no authority: every private read is authorised separately.';
comment on column gateq.gateways.created_by_user_id is
  'Audit provenance. Never authority: authority is the owning organisation''s, through membership and capabilities.';

create index gateways_by_investor_idx
  on gateq.gateways (tenant_id, investor_organisation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Versions: one row per configuration, one publication at a time.
-- ---------------------------------------------------------------------------

create table gateq.gateway_versions (
  id                            uuid primary key default gen_random_uuid(),
  gateway_id                    uuid not null references gateq.gateways (id) on delete restrict,
  tenant_id                     uuid not null references identity.tenants (id) on delete restrict,
  -- Monotonic per gateway. A published number is never reused, so a stored
  -- qualification result naming version 3 always means the same policy.
  version_number                integer not null check (version_number >= 1),

  status                        text not null default 'DRAFT'
                                  check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED')),

  -- The door's setting, and the reason CLOSED is a mode rather than an
  -- absent gateway: an organisation that is not taking unsolicited
  -- applications should be able to say so plainly (§20).
  inbound_mode                  text not null
                                  check (inbound_mode in ('CLOSED', 'QUALIFIED', 'OPEN')),

  -- Public-facing wording only. Private notes and rejection logic have no
  -- column here, so there is nothing to leak.
  public_title                  text not null check (length(btrim(public_title)) between 1 and 160),
  public_description            text check (public_description is null or length(public_description) between 1 and 2000),

  -- The engine contract this version's results were produced under.
  qualification_policy_version  text not null
                                  check (qualification_policy_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),

  created_by_user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  published_by_user_id          uuid references identity.user_profiles (id) on delete restrict,
  published_at                  timestamptz,
  superseded_at                 timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  unique (gateway_id, version_number),
  -- Publication is an authorised human act, so it always has an author and
  -- a time. A superseded or archived version keeps both: it was published
  -- once, and a stored qualification result still names it.
  check (status <> 'PUBLISHED' or published_at is not null),
  check (status <> 'SUPERSEDED' or published_at is not null),
  check ((published_at is null) = (published_by_user_id is null)),
  check (superseded_at is null or published_at is not null)
);

comment on table gateq.gateway_versions is
  'One gateway configuration. Versions are rows rather than an overwritten column so a historical qualification result stays attributable to the exact policy that produced it.';

-- At most one published version per gateway, enforced by the database
-- rather than by whoever writes the publish path next.
create unique index gateway_versions_one_published_idx
  on gateq.gateway_versions (gateway_id)
  where status = 'PUBLISHED';

create index gateway_versions_by_gateway_idx
  on gateq.gateway_versions (gateway_id, version_number desc);

-- ---------------------------------------------------------------------------
-- Criteria: the investor's explicit, published inbound policy.
-- ---------------------------------------------------------------------------

create table gateq.gateway_criteria (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references gateq.gateway_versions (id) on delete cascade,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  position          integer not null check (position between 1 and 64),

  -- REQUIRED can refuse an application; PREFERRED never does (§8). Two
  -- values and no weights: a numeric threshold here would be a second
  -- ranker with none of REC-005's governance or calibration.
  requiredness      text not null check (requiredness in ('REQUIRED', 'PREFERRED')),

  -- The dimensions this version of the engine can actually evaluate, each
  -- backed by canonical declared data. Revenue, traction and readiness are
  -- deliberately absent rather than present and permanently unknown: a
  -- gateway must not be able to publish a policy Capital Q could never
  -- answer.
  criterion_type    text not null check (criterion_type in (
                      'TAXONOMY', 'GEOGRAPHY', 'STAGE',
                      'RAISE_SIZE', 'CHEQUE_COMPATIBILITY', 'EXCLUDED_TAXONOMY')),

  -- Display only. Stored authority is the config's canonical ids.
  label             text not null check (length(btrim(label)) between 1 and 120),

  -- A bounded, discriminated payload -- not arbitrary user JSON. The object
  -- is validated against a closed Zod union at the service boundary before
  -- it ever reaches here, and its `type` must agree with the column so a
  -- row cannot claim to be one kind of rule and hold another.
  config            jsonb not null
                      check (jsonb_typeof(config) = 'object'
                         and config ? 'type'
                         and config ->> 'type' = criterion_type
                         and pg_column_size(config) <= 8192),

  created_at        timestamptz not null default now(),

  unique (version_id, position)
);

comment on table gateq.gateway_criteria is
  'One published inbound rule. Taxonomy criteria reference canonical node ids; a label is for display and is never the stored authority.';
comment on column gateq.gateway_criteria.config is
  'Bounded discriminated payload validated by Zod at the service boundary. Never arbitrary client JSON, never free-text sector matching.';

create index gateway_criteria_by_version_idx
  on gateq.gateway_criteria (version_id, position);

-- ---------------------------------------------------------------------------
-- A published version is immutable except for its own lifecycle.
-- ---------------------------------------------------------------------------

create or replace function gateq.protect_published_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'a published gateway version is history and is never deleted'
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status in ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') then
    -- Lifecycle may move forward; the policy it carried may not change,
    -- because somebody's qualification result already names this row.
    if new.gateway_id is distinct from old.gateway_id
       or new.version_number is distinct from old.version_number
       or new.inbound_mode is distinct from old.inbound_mode
       or new.public_title is distinct from old.public_title
       or new.public_description is distinct from old.public_description
       or new.qualification_policy_version is distinct from old.qualification_policy_version
       or new.created_by_user_id is distinct from old.created_by_user_id
       or new.published_at is distinct from old.published_at
       or new.published_by_user_id is distinct from old.published_by_user_id then
      raise exception 'a published gateway version is immutable; publish a new version instead'
        using errcode = 'restrict_violation';
    end if;
    if old.status <> 'PUBLISHED' and new.status = 'PUBLISHED' then
      raise exception 'a superseded or archived version is never republished'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function gateq.protect_published_version() from public;

create trigger gateway_versions_protect_published
  before update or delete on gateq.gateway_versions
  for each row execute function gateq.protect_published_version();

-- A criterion belongs to the version it was published with. Editing one in
-- place would rewrite a policy somebody was already judged against.
create or replace function gateq.protect_published_criteria()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  version_status text;
begin
  select v.status into version_status
    from gateq.gateway_versions v
   where v.id = coalesce(new.version_id, old.version_id);
  if version_status is not null and version_status <> 'DRAFT' then
    raise exception 'the criteria of a published gateway version are immutable'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function gateq.protect_published_criteria() from public;

create trigger gateway_criteria_protect_published
  before insert or update or delete on gateq.gateway_criteria
  for each row execute function gateq.protect_published_criteria();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
--
-- Inbound policy is commercially sensitive -- which sectors an investor
-- will and will not look at is exactly what a competitor would like -- and
-- a draft is not published at all. The public sees one controlled
-- projection through the API, never a table.
-- ---------------------------------------------------------------------------

alter table gateq.gateways enable row level security;
alter table gateq.gateway_versions enable row level security;
alter table gateq.gateway_criteria enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('investor.gateway.create',  'Create an inbound gateway for the investor organisation.'),
  ('investor.gateway.view',    'Read the investor organisation''s gateways, drafts and versions.'),
  ('investor.gateway.edit',    'Create and edit gateway configuration drafts.'),
  ('investor.gateway.publish', 'Publish a gateway version, changing who may approach the organisation.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'investor.gateway.create'),
      ('organisation_admin',  'investor.gateway.view'),
      ('organisation_admin',  'investor.gateway.edit'),
      -- Publishing is deliberately admin-only: an ordinary member may read
      -- the policy and may not change who reaches their organisation.
      ('organisation_admin',  'investor.gateway.publish'),
      ('organisation_member', 'investor.gateway.view')
    )
on conflict (role_id, capability_id) do nothing;
