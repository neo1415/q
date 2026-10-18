-- Handles and the Q Card (BIZ-004; lead-owned migration).
--
-- A handle is a display route (`/@kivu-freight`), never a foreign key: the
-- canonical UUID stays the identity, and the per-tenant `slug` columns are
-- untouched. Handles are global, lowercase and unique among live rows. A
-- rename keeps the old handle HELD for 90 days (it redirects and nobody else
-- may take it); a verified organisation's old handle is RETIRED and never
-- recycled. Rows are history: they are never deleted and a handle never
-- changes owner in place.
--
-- A shareable identity (the Q Card) is the owner's deliberate choice of
-- which declared fields appear on the card and to whom -- public_external
-- or network_visible, and nothing narrower can be chosen, so a
-- founder_private or organisation_private field has no way onto a card.
-- The data itself stays in the canonical profile; nothing is copied here.
--
-- Everything is server-internal (RLS on, no policies, no client grants):
-- the public page reads through the API's allowlisted projection.

-- ---------------------------------------------------------------------------
-- Reserved handles: reference data, not an enum.
-- ---------------------------------------------------------------------------

create table core.reserved_handles (
  handle      text primary key check (handle ~ '^[a-z0-9-]{1,40}$'),
  reason      text not null check (reason in ('PLATFORM', 'ROLE', 'BRAND')),
  created_at  timestamptz not null default now()
);

comment on table core.reserved_handles is
  'Handles nobody may claim through self-service: platform routes, staff roles, well-known brands (claimable later only through verification by an operator).';

alter table core.reserved_handles enable row level security;

insert into core.reserved_handles (handle, reason) values
  ('admin', 'ROLE'), ('administrator', 'ROLE'), ('ops', 'ROLE'), ('operator', 'ROLE'),
  ('staff', 'ROLE'), ('support', 'ROLE'), ('help', 'ROLE'), ('security', 'ROLE'),
  ('legal', 'ROLE'), ('abuse', 'ROLE'), ('privacy', 'ROLE'), ('trust', 'ROLE'),
  ('q', 'PLATFORM'), ('capitalq', 'PLATFORM'), ('capital-q', 'PLATFORM'),
  ('api', 'PLATFORM'), ('www', 'PLATFORM'), ('app', 'PLATFORM'), ('settings', 'PLATFORM'),
  ('verify', 'PLATFORM'), ('verification', 'PLATFORM'), ('auth', 'PLATFORM'),
  ('login', 'PLATFORM'), ('signin', 'PLATFORM'), ('signup', 'PLATFORM'),
  ('home', 'PLATFORM'), ('discover', 'PLATFORM'), ('profile', 'PLATFORM'),
  ('company', 'PLATFORM'), ('capital', 'PLATFORM'), ('gateq', 'PLATFORM'),
  ('card', 'PLATFORM'), ('cards', 'PLATFORM'), ('status', 'PLATFORM'),
  ('fdn', 'PLATFORM'), ('null', 'PLATFORM'), ('undefined', 'PLATFORM'),
  ('sequoia', 'BRAND'), ('a16z', 'BRAND'), ('accel', 'BRAND'), ('ycombinator', 'BRAND'),
  ('stripe', 'BRAND'), ('google', 'BRAND'), ('openai', 'BRAND'), ('anthropic', 'BRAND')
on conflict (handle) do nothing;

-- ---------------------------------------------------------------------------
-- core.handles
-- ---------------------------------------------------------------------------

create table core.handles (
  id                  uuid primary key default gen_random_uuid(),
  -- 3-30 characters, lowercase letters, digits and single hyphens, never at
  -- either end. Case-insensitive by construction: only lowercase is stored.
  handle              text not null
                        check (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'
                               and handle !~ '--'),
  tenant_id           uuid not null,
  organisation_id     uuid not null,
  subject_type        text not null check (subject_type in ('COMPANY', 'INVESTOR_ORGANISATION')),
  subject_id          uuid not null,
  status              text not null default 'ACTIVE'
                        check (status in ('ACTIVE', 'HELD', 'RETIRED', 'RELEASED')),
  claimed_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  claimed_at          timestamptz not null default clock_timestamp(),
  released_at         timestamptz,
  hold_until          timestamptz,
  check ((status = 'ACTIVE') = (released_at is null)),
  check ((status = 'HELD') = (hold_until is not null)),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table core.handles is
  'Global display routes for companies and investor organisations. ACTIVE: in use. HELD: renamed away, redirects and is unclaimable until hold_until. RETIRED: a verified organisation''s old handle, redirects and is never recycled. RELEASED: an expired hold, history only.';

-- Unique among live rows; an expired hold is RELEASED before a new claim.
create unique index handles_live_handle_idx
  on core.handles (handle) where status <> 'RELEASED';
-- One current handle per subject.
create unique index handles_one_active_per_subject_idx
  on core.handles (subject_type, subject_id) where status = 'ACTIVE';
create index handles_subject_idx on core.handles (subject_type, subject_id);

create or replace function core.guard_handle_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'handles are history and cannot be deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from core.reserved_handles r where r.handle = new.handle) then
      raise exception 'that handle is reserved' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.handle is distinct from old.handle
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.tenant_id is distinct from old.tenant_id
     or new.organisation_id is distinct from old.organisation_id
     or new.claimed_at is distinct from old.claimed_at then
    raise exception 'a handle never changes owner or spelling in place' using errcode = 'check_violation';
  end if;
  -- Retired is final: a verified organisation's handle is never recycled.
  if old.status = 'RETIRED' and new.status <> 'RETIRED' then
    raise exception 'a retired handle is never recycled' using errcode = 'check_violation';
  end if;
  if old.status = 'RELEASED' and new.status <> 'RELEASED' then
    raise exception 'a released handle row is history' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function core.guard_handle_history() from public;

create trigger handles_history_only
  before insert or update or delete on core.handles
  for each row execute function core.guard_handle_history();

alter table core.handles enable row level security;
-- No policies and no client grants: server-internal.

-- ---------------------------------------------------------------------------
-- core.shareable_identities  (the Q Card)
-- ---------------------------------------------------------------------------

create or replace function core.card_field_scopes_valid(scopes jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(scopes) = 'object'
     and not exists (
       select 1
         from jsonb_each(scopes) as e(key, value)
        where e.key !~ '^[a-zA-Z]{1,40}$'
           or jsonb_typeof(e.value) <> 'string'
           or (e.value #>> '{}') not in ('public_external', 'network_visible')
     );
$$;

create table core.shareable_identities (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  organisation_id  uuid not null,
  subject_type     text not null check (subject_type in ('COMPANY', 'INVESTOR_ORGANISATION')),
  subject_id       uuid not null,
  -- The short first-party code a QR encodes (/c/<code>). Opaque, so cards
  -- cannot be enumerated; revocable by status.
  public_code      text not null unique check (public_code ~ '^[a-z0-9]{10}$'),
  -- field key -> 'public_external' | 'network_visible'. A field absent from
  -- the map is not on the card. Nothing narrower is expressible.
  field_scopes     jsonb not null default '{}'::jsonb
                     check (core.card_field_scopes_valid(field_scopes)),
  -- noindex unless the owner opts in.
  indexable        boolean not null default false,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  version          integer not null default 1 check (version >= 1),
  created_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default clock_timestamp(),
  unique (subject_type, subject_id),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table core.shareable_identities is
  'The Q Card: which declared profile fields appear on the shareable card and to whom (public_external or network_visible). Presentation over the canonical profile; holds no profile data.';

create trigger set_updated_at
  before update on core.shareable_identities
  for each row execute function private.set_updated_at();

alter table core.shareable_identities enable row level security;

-- First-party, aggregate-only scan counts: a day and a number. No person,
-- address, device or referrer is ever recorded, so "who viewed your card"
-- cannot be answered (PADL #128).
create table core.shareable_identity_scans (
  shareable_identity_id  uuid not null references core.shareable_identities (id) on delete restrict,
  day                    date not null,
  scans                  integer not null default 0 check (scans >= 0),
  primary key (shareable_identity_id, day)
);

comment on table core.shareable_identity_scans is
  'Daily first-party scan counts for a Q Card short link. Aggregate only, by design.';

alter table core.shareable_identity_scans enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data: who may claim a handle and publish a card
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('handle.manage', 'Claim or change the organisation''s public handle and publish its Q Card (a public representation of the organisation).')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (('organisation_admin', 'handle.manage'))
on conflict (role_id, capability_id) do nothing;
