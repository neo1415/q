-- DEMO REHEARSAL ACCESS (founder direction 2026-10-11).
--
-- An entitlement meaning exactly one thing: "this tenant's founders may
-- rehearse with a researched, labelled simulation of this prepared public
-- entity". It is NOT a relationship, connection, message, meeting, interest
-- or mandate, and nothing here writes network.relationships,
-- network.relationship_events, messages, meetings, interests or mandates.
--
-- Scope: it only lets the rehearsal service skip the Discover visibility
-- check for a prepared, unclaimed public profile, and lists the entity under
-- "Researched rehearsals". It grants no read of any investor or research
-- table. Without a live grant, every rehearsal permission is unchanged.
--
-- Tenant-owned; server-written (privileged role only); a tenant's active
-- members may read their own tenant's rows. A revoked grant is kept as
-- history (revoked_at), never deleted. Additive and idempotent.
--
-- Rollback: drop function q_runtime.grant_demo_rehearsal_access(uuid);
--           drop table q_runtime.demo_rehearsal_access;
-- (or revoke one grant: update ... set revoked_at = now()).

create table if not exists q_runtime.demo_rehearsal_access (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  external_person_id  uuid not null references q_runtime.external_persons (id) on delete cascade,
  granted_at          timestamptz not null default clock_timestamp(),
  revoked_at          timestamptz,
  reason              text not null default 'demo rehearsal access'
                        check (length(reason) between 1 and 300),
  unique (tenant_id, external_person_id),
  check (revoked_at is null or revoked_at >= granted_at)
);

comment on table q_runtime.demo_rehearsal_access is
  'Demo rehearsal access: a tenant''s founders may rehearse with a researched simulation of a prepared public entity. Not a relationship, connection, message or mandate. Server-written.';

create index if not exists demo_rehearsal_access_live_idx
  on q_runtime.demo_rehearsal_access (tenant_id)
  where revoked_at is null;

alter table q_runtime.demo_rehearsal_access enable row level security;

drop policy if exists demo_rehearsal_access_select_tenant on q_runtime.demo_rehearsal_access;
create policy demo_rehearsal_access_select_tenant
  on q_runtime.demo_rehearsal_access for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

revoke all on q_runtime.demo_rehearsal_access from public, anon, authenticated;
grant select on q_runtime.demo_rehearsal_access to authenticated;
grant select, insert, update, delete on q_runtime.demo_rehearsal_access to postgres, service_role;

-- Grant a tenant access to every prepared public entity. Idempotent; a grant
-- already revoked stays revoked (do nothing), so a reload never re-grants.
create or replace function q_runtime.grant_demo_rehearsal_access(p_tenant_id uuid)
returns integer
language sql
set search_path = pg_catalog, q_runtime
as $$
  with ins as (
    insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id)
    select p_tenant_id, p.id
      from q_runtime.external_persons p
     where p.tenant_id is null
       and p.research_status = 'PREPARED_PUBLIC_SEED'
    on conflict (tenant_id, external_person_id) do nothing
    returning 1)
  select count(*)::int from ins
$$;

revoke all on function q_runtime.grant_demo_rehearsal_access(uuid) from public, anon, authenticated;
grant execute on function q_runtime.grant_demo_rehearsal_access(uuid) to postgres, service_role;

-- Backfill: every existing seeded demo founder's tenant (the fictional
-- accounts, the +cq- cast, and the named demo founders including Spheros).
-- A tenant with no such founder gets nothing.
select q_runtime.grant_demo_rehearsal_access(t.tenant_id)
  from (
    select distinct cm.tenant_id
      from core.company_members cm
      join identity.user_profiles up on up.id = cm.user_id
      join auth.users u on u.id = up.auth_user_id
     where cm.is_founder and cm.is_current
       and (u.email ilike '%@fictional.capitalq.local'
         or u.email ilike 'adedaniel502+cq-%@gmail.com'
         or u.email in ('neowalker502@gmail.com', 'skyneo502@gmail.com',
                        'adetimilehin502@gmail.com'))
  ) t;
