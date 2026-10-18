-- G1/G2 · Organisations as teams: owners, invitations, join requests and
-- ownership hand-over (docs/research/2026-10-06/organisations.md).
--
-- Builds on the CQ-DATA-002 identity model; nothing here duplicates it:
--
--   Person (user_profiles) ≠ Organisation ≠ Membership ≠ Role ≠ Capability
--
-- Owner is a ROLE, not a column: `organisation_owner` carries the new
-- `organisation.own` capability and is always held beside
-- `organisation_admin`. The UI's three roles map onto role templates:
--
--   Owner  = organisation_admin + organisation_owner
--   Admin  = organisation_admin
--   Member = organisation_member
--
-- Invariant (also enforced in code, under a lock on the organisation row):
-- an active organisation that still has active members always keeps at least
-- one owner. The constraint trigger below refuses, at commit, any change
-- that takes the last owner away (their membership ending, or their owner
-- role ending). It checks at commit so a hand-over inside one transaction
-- (make the new owner, then step down) is fine in either order.
--
-- Invitations store only a SHA-256 hash of the link token; the token itself
-- is only ever in the email. Expiry is `expires_at`; an expired invitation
-- stays `pending` until resent (which rotates the token) or revoked.
--
-- RLS: every new table has RLS on. Browser sessions may read (never write):
-- invitations and join requests of organisations where they hold
-- `organisation.admin`, their own join requests, and ownership offers they
-- are a party to. Every write goes through the server application, which is
-- where business authorisation lives.

-- ---------------------------------------------------------------------------
-- Owner role and capability
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('organisation.own',
   'Own the organisation: make or remove owners, hand over ownership, close it, billing.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.roles (code, name, description, scope_type) values
  ('organisation_owner', 'Organisation owner',
   'Owns the organisation; always held beside organisation_admin. Every active organisation with members keeps at least one.',
   'organisation')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      scope_type = excluded.scope_type;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_owner', 'organisation.view'),
      ('organisation_owner', 'organisation.own')
    )
on conflict (role_id, capability_id) do nothing;

-- ---------------------------------------------------------------------------
-- Backfill: every active organisation with active members gets an owner.
-- The earliest active admin; failing that, the earliest active member (who
-- then also becomes an admin, since an owner always is one).
-- ---------------------------------------------------------------------------

with owner_role as (
  select id from permissions.roles where code = 'organisation_owner'
), admin_role as (
  select id from permissions.roles where code = 'organisation_admin'
), unowned as (
  select o.id as organisation_id
    from identity.organisations o
   where o.status = 'active'
     and exists (select 1 from identity.organisation_memberships m
                  where m.organisation_id = o.id and m.membership_status = 'active')
     and not exists (
       select 1
         from identity.organisation_memberships m
         join identity.membership_roles mr on mr.membership_id = m.id
        where m.organisation_id = o.id
          and m.membership_status = 'active'
          and mr.role_id = (select id from owner_role)
          and mr.valid_from <= now()
          and (mr.valid_until is null or mr.valid_until > now()))
), chosen as (
  select distinct on (u.organisation_id)
         u.organisation_id,
         m.id as membership_id,
         exists (
           select 1 from identity.membership_roles mr
            where mr.membership_id = m.id
              and mr.role_id = (select id from admin_role)
              and mr.valid_from <= now()
              and (mr.valid_until is null or mr.valid_until > now())) as is_admin
    from unowned u
    join identity.organisation_memberships m
      on m.organisation_id = u.organisation_id and m.membership_status = 'active'
   order by u.organisation_id,
            -- admins first, then the earliest to join
            (exists (
              select 1 from identity.membership_roles mr
               where mr.membership_id = m.id
                 and mr.role_id = (select id from admin_role)
                 and mr.valid_from <= now()
                 and (mr.valid_until is null or mr.valid_until > now()))) desc,
            m.joined_at, m.id
), grant_admin as (
  insert into identity.membership_roles (membership_id, role_id)
  select c.membership_id, (select id from admin_role)
    from chosen c
   where not c.is_admin
  returning membership_id
)
insert into identity.membership_roles (membership_id, role_id)
select c.membership_id, (select id from owner_role)
  from chosen c;

-- ---------------------------------------------------------------------------
-- The last-owner invariant
-- ---------------------------------------------------------------------------

create function private.organisation_has_owner(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from identity.organisation_memberships m
      join identity.membership_roles mr on mr.membership_id = m.id
      join permissions.roles r on r.id = mr.role_id
     where m.organisation_id = p_organisation_id
       and m.membership_status = 'active'
       and r.code = 'organisation_owner'
       and mr.valid_from <= now()
       and (mr.valid_until is null or mr.valid_until > now()))
$$;

revoke all on function private.organisation_has_owner(uuid) from public;

create function private.organisation_keeps_an_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organisation_id uuid;
  v_membership_id   uuid;
begin
  if tg_table_name = 'organisation_memberships' then
    -- Only an active membership that stops being active can take an owner away.
    if old.membership_status <> 'active' or new.membership_status = 'active' then
      return null;
    end if;
    v_organisation_id := old.organisation_id;
    v_membership_id := old.id;
    -- Was this membership an owner when it was active?
    if not exists (
      select 1
        from identity.membership_roles mr
        join permissions.roles r on r.id = mr.role_id
       where mr.membership_id = v_membership_id
         and r.code = 'organisation_owner'
         and mr.valid_from <= now()
         and (mr.valid_until is null or mr.valid_until > now())) then
      return null;
    end if;
  else
    -- identity.membership_roles: an owner assignment that was current and
    -- no longer is (validity ended, or the row deleted).
    if not exists (select 1 from permissions.roles r
                    where r.id = old.role_id and r.code = 'organisation_owner') then
      return null;
    end if;
    if not (old.valid_from <= now() and (old.valid_until is null or old.valid_until > now())) then
      return null;
    end if;
    if tg_op = 'UPDATE'
       and new.valid_from <= now()
       and (new.valid_until is null or new.valid_until > now()) then
      return null;
    end if;
    select m.organisation_id into v_organisation_id
      from identity.organisation_memberships m
     where m.id = old.membership_id
       and m.membership_status = 'active';
    if v_organisation_id is null then
      return null;
    end if;
  end if;

  -- A closed or suspended organisation is not held to it, nor one nobody
  -- is active in any more.
  if not exists (select 1 from identity.organisations o
                  where o.id = v_organisation_id and o.status = 'active') then
    return null;
  end if;
  if not exists (select 1 from identity.organisation_memberships m
                  where m.organisation_id = v_organisation_id
                    and m.membership_status = 'active') then
    return null;
  end if;

  if not private.organisation_has_owner(v_organisation_id) then
    raise exception 'organisation % must keep at least one owner', v_organisation_id
      using errcode = '23514', hint = 'LAST_OWNER';
  end if;
  return null;
end;
$$;

revoke all on function private.organisation_keeps_an_owner() from public;

create constraint trigger organisation_memberships_keep_an_owner
  after update of membership_status on identity.organisation_memberships
  deferrable initially deferred
  for each row execute function private.organisation_keeps_an_owner();

create constraint trigger membership_roles_keep_an_owner
  after update or delete on identity.membership_roles
  deferrable initially deferred
  for each row execute function private.organisation_keeps_an_owner();

-- ---------------------------------------------------------------------------
-- Policy helper: does the signed-in person hold a capability, through a
-- current role, in an organisation they are actively a member of?
--
-- SECURITY INVOKER on purpose: under RLS the person sees only their own
-- memberships and role assignments, which is exactly the question.
-- ---------------------------------------------------------------------------

create function private.holds_organisation_capability(
  p_organisation_id uuid,
  p_capability text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from identity.organisation_memberships m
      join identity.membership_roles mr on mr.membership_id = m.id
      join permissions.role_capabilities rc on rc.role_id = mr.role_id and rc.effect = 'ALLOW'
      join permissions.capabilities c on c.id = rc.capability_id and c.status = 'active'
     where m.organisation_id = p_organisation_id
       and m.user_id = (select private.current_app_user_id())
       and m.membership_status = 'active'
       and c.code = p_capability
       and mr.valid_from <= now()
       and (mr.valid_until is null or mr.valid_until > now()))
$$;

revoke all on function private.holds_organisation_capability(uuid, text) from public;
grant execute on function private.holds_organisation_capability(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- identity.organisation_invitations
-- ---------------------------------------------------------------------------

create table identity.organisation_invitations (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  organisation_id         uuid not null,
  -- Normalised: trimmed, lower case. Personal addresses are fine.
  email                   text not null
                            check (email = lower(btrim(email))
                                   and length(email) between 3 and 254
                                   and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- One role per invitation. Owners are never invited; ownership is handed over.
  role_code               text not null check (role_code in ('admin', 'member')),
  message                 text check (message is null or length(message) <= 500),
  -- SHA-256 of the link token. The token is never stored.
  token_hash              text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status                  text not null default 'pending'
                            check (status in ('pending', 'accepted', 'revoked')),
  invited_by_user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  sent_count              integer not null default 1 check (sent_count between 1 and 20),
  last_sent_at            timestamptz not null default now(),
  expires_at              timestamptz not null,
  decided_at              timestamptz,
  decided_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  accepted_membership_id  uuid references identity.organisation_memberships (id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  check (expires_at > created_at),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'pending') = (decided_by_user_id is null)),
  check ((status = 'accepted') = (accepted_membership_id is not null))
);

comment on table identity.organisation_invitations is
  'An email invitation to join an organisation with one role (G1). Token hash only; expiry by expires_at; accepted, revoked or still pending. Not a membership: accepting creates one.';

create unique index organisation_invitations_one_pending_idx
  on identity.organisation_invitations (organisation_id, email)
  where status = 'pending';
create index organisation_invitations_organisation_idx
  on identity.organisation_invitations (organisation_id, status, created_at desc);
create index organisation_invitations_tenant_idx
  on identity.organisation_invitations (tenant_id);

create trigger set_updated_at
  before update on identity.organisation_invitations
  for each row execute function private.set_updated_at();

alter table identity.organisation_invitations enable row level security;

create policy organisation_invitations_select_admin
  on identity.organisation_invitations for select to authenticated
  using ((select private.holds_organisation_capability(organisation_id, 'organisation.admin')));

grant select on identity.organisation_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- identity.organisation_join_requests
-- ---------------------------------------------------------------------------

create table identity.organisation_join_requests (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid not null,
  -- The Person asking to join; never a membership until an admin lets them in.
  user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  message             text check (message is null or length(message) <= 500),
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  decided_at          timestamptz,
  membership_id       uuid references identity.organisation_memberships (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'approved') = (membership_id is not null))
);

comment on table identity.organisation_join_requests is
  'A person asking to join an organisation (G1). Admins let them in (a membership with the Member role) or decline.';

create unique index organisation_join_requests_one_pending_idx
  on identity.organisation_join_requests (organisation_id, user_id)
  where status = 'pending';
create index organisation_join_requests_organisation_idx
  on identity.organisation_join_requests (organisation_id, status, created_at desc);
create index organisation_join_requests_user_idx
  on identity.organisation_join_requests (user_id);
create index organisation_join_requests_tenant_idx
  on identity.organisation_join_requests (tenant_id);

create trigger set_updated_at
  before update on identity.organisation_join_requests
  for each row execute function private.set_updated_at();

alter table identity.organisation_join_requests enable row level security;

create policy organisation_join_requests_select_own_or_admin
  on identity.organisation_join_requests for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.holds_organisation_capability(organisation_id, 'organisation.admin'))
  );

grant select on identity.organisation_join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- identity.organisation_ownership_offers
--
-- An owner offers ownership to a member; the member accepts (no dumping),
-- and both are owners. The old owner may then step down or leave.
-- ---------------------------------------------------------------------------

create table identity.organisation_ownership_offers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid not null,
  from_membership_id  uuid not null references identity.organisation_memberships (id) on delete restrict,
  to_membership_id    uuid not null references identity.organisation_memberships (id) on delete restrict,
  status              text not null default 'pending'
                        check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  check (from_membership_id <> to_membership_id),
  check ((status = 'pending') = (decided_at is null))
);

comment on table identity.organisation_ownership_offers is
  'Ownership hand-over (G2): an owner offers, the member accepts and becomes an owner too.';

create unique index organisation_ownership_offers_one_pending_idx
  on identity.organisation_ownership_offers (organisation_id, to_membership_id)
  where status = 'pending';
create index organisation_ownership_offers_organisation_idx
  on identity.organisation_ownership_offers (organisation_id, status);
create index organisation_ownership_offers_from_idx
  on identity.organisation_ownership_offers (from_membership_id);
create index organisation_ownership_offers_to_idx
  on identity.organisation_ownership_offers (to_membership_id);
create index organisation_ownership_offers_tenant_idx
  on identity.organisation_ownership_offers (tenant_id);

create trigger set_updated_at
  before update on identity.organisation_ownership_offers
  for each row execute function private.set_updated_at();

alter table identity.organisation_ownership_offers enable row level security;

create policy organisation_ownership_offers_select_party
  on identity.organisation_ownership_offers for select to authenticated
  using (exists (
    select 1 from identity.organisation_memberships m
     where m.id in (from_membership_id, to_membership_id)
       and m.user_id = (select private.current_app_user_id())
  ));

grant select on identity.organisation_ownership_offers to authenticated;
