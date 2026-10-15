-- RECOVERY K, Part 11 (workstream F): what makes a cached Q context stale.
--
-- Q now keeps prepared context between turns (Tier A per-actor snapshots in
-- q-api, Tier B projections in Postgres, GPT-Live context packages). A
-- cache keyed only by who is asking would keep serving what someone was
-- allowed to see after the permission is gone. Each cached entry is
-- therefore keyed by two fingerprints, read fresh on every lookup; the
-- moment either changes, the old entry can no longer be found
-- (docs/recovery/specs/K-security.md):
--
--   actor_authz_epoch     everything about the ASKER that decides access:
--                         their profile status, every membership (status,
--                         left_at), every role assignment and its validity,
--                         and every grant to them, their memberships or
--                         their organisations (revocation, expiry). Org
--                         switch is in the cache key directly.
--   subject_access_epoch  everything about a COMPANY that decides what a
--                         given viewer organisation may see of it: its
--                         marketplace visibility and status, its data-room
--                         setting, its disclosure policies (revocation,
--                         expiry), and the relationship between it and the
--                         viewer's investor organisation.
--
-- Fingerprints only: an md5 over ids, states and timestamps, never a value
-- a person wrote. Time-bounded validity (valid_until, expires_at) is
-- evaluated against now(), so an expiry changes the fingerprint at the
-- moment it happens, without any write.
--
-- Over-invalidation is safe (a cache miss); under-invalidation is the
-- defect this exists to prevent, so the inputs err wide.

create function private.actor_authz_epoch(
  p_user_id uuid,
  p_tenant_id uuid,
  p_membership_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  with memberships as (
    select m.id, m.organisation_id, m.membership_status, m.updated_at, m.left_at
      from identity.organisation_memberships m
     where m.user_id = p_user_id
  )
  select md5(concat_ws('|',
    'v1',
    p_user_id::text,
    coalesce(p_tenant_id::text, '-'),
    coalesce(p_membership_id::text, '-'),
    (select p.status || ':' || p.version::text
       from identity.user_profiles p where p.id = p_user_id),
    (select string_agg(
              m.id::text || ':' || m.membership_status || ':' || m.updated_at::text
              || ':' || coalesce(m.left_at::text, ''), ',' order by m.id)
       from memberships m),
    (select string_agg(
              r.id::text || ':' || r.role_id::text || ':' || r.valid_from::text
              || ':' || coalesce(r.valid_until::text, '')
              || ':' || (r.valid_from <= now()
                         and (r.valid_until is null or r.valid_until > now()))::text,
              ',' order by r.id)
       from identity.membership_roles r
       join memberships m on m.id = r.membership_id),
    (select string_agg(
              g.id::text || ':' || g.effect || ':' || coalesce(g.revoked_at::text, '')
              || ':' || (g.revoked_at is null and g.valid_from <= now()
                         and (g.valid_until is null or g.valid_until > now()))::text,
              ',' order by g.id)
       from permissions.grants g
      where (g.principal_type = 'user' and g.principal_id = p_user_id)
         or (g.principal_type = 'membership'
             and g.principal_id in (select m.id from memberships m))
         or (g.principal_type = 'organisation'
             and g.principal_id in (select m.organisation_id from memberships m)))
  ));
$$;

comment on function private.actor_authz_epoch(uuid, uuid, uuid) is
  'K Part 11: a fingerprint of everything about the asker that decides access (profile status, memberships, role validity, grants). A cached Q context is keyed by it; any revocation, role change, membership change or expiry changes it.';

create function private.subject_access_epoch(
  p_company_id uuid,
  p_viewer_organisation_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  with company as (
    select c.id, c.organisation_id, c.marketplace_visibility,
           c.marketplace_readiness_state, c.company_status, c.version, c.updated_at
      from core.companies c
     where c.id = p_company_id
  )
  select md5(concat_ws('|',
    'v1',
    p_company_id::text,
    coalesce(p_viewer_organisation_id::text, '-'),
    (select c.marketplace_visibility::text || ':' || coalesce(c.marketplace_readiness_state::text, '')
            || ':' || c.company_status::text || ':' || c.version::text || ':' || c.updated_at::text
       from company c),
    (select s.outline_before_connection::text || ':' || s.updated_at::text
       from evidence.data_room_settings s where s.company_id = p_company_id),
    (select string_agg(
              d.id::text || ':' || d.access_level::text || ':' || coalesce(d.revoked_at::text, '')
              || ':' || (d.revoked_at is null
                         and (d.expires_at is null or d.expires_at > now()))::text,
              ',' order by d.id)
       from permissions.disclosure_policies d
      where d.owner_organisation_id = (select c.organisation_id from company c)),
    (select string_agg(
              r.id::text || ':' || r.current_state::text || ':' || r.state_updated_at::text
              || ':' || r.last_event_sequence::text,
              ',' order by r.id)
       from network.relationships r
       join core.investor_organisations i on i.id = r.investor_organisation_id
      where r.company_id = p_company_id
        and i.organisation_id = p_viewer_organisation_id)
  ));
$$;

comment on function private.subject_access_epoch(uuid, uuid) is
  'K Part 11: a fingerprint of everything about a company that decides what a viewer organisation may see of it (visibility, data-room setting, disclosure policies, the relationship). Investor-facing cached context about a company is keyed by it.';

revoke all on function private.actor_authz_epoch(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.subject_access_epoch(uuid, uuid) from public, anon, authenticated;
grant execute on function private.actor_authz_epoch(uuid, uuid, uuid) to service_role;
grant execute on function private.subject_access_epoch(uuid, uuid) to service_role;
