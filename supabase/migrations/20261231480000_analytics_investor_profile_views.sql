-- Q Workspace §8 · who viewed an investor (owner live test, 7 Nov 2026).
--
-- Founders viewing an investor's profile (/investors/[id]) were never
-- recorded: analytics.engagement_events has one subject, a company. This
-- table records those views, with the same guarantees, and the projection
-- below is the ONLY way an investor reads them. Design and root cause:
-- docs/specs/q-workspace/ANALYTICS_INVESTOR_VIEWERS.md.
--
--   - Same stamp trigger: the viewer's own visibility choice, from the
--     database, never the caller (analytics.stamp_engagement_event()).
--   - Append-only (analytics.protect_engagement_event()); RLS own rows only;
--     writes are server-only, after the founder's own authorised investor
--     read (ADR 0023).
--   - Shown to the investor as aggregates only (the specification default;
--     investors never pay for identity, DECISIONS 74): completed weeks, at
--     least analytics.engagement_floor() founder organisations, slices at
--     least analytics.slice_floor() with complementary suppression, the
--     investor's own team never counted.
--   - Viewing is not contact permission (§6.7.14): nothing here returns a
--     way to reach a viewer.

create table analytics.investor_profile_views (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  viewer_user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  viewer_organisation_id    uuid not null,
  investor_organisation_id  uuid not null,
  investor_tenant_id        uuid not null,
  view_type                 text not null check (view_type in ('INVESTOR_PROFILE_VIEW')),
  engagement_version        text not null check (engagement_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  visibility_at_view        text not null check (visibility_at_view in ('FULL_IDENTITY', 'ORGANISATION_ONLY', 'ANONYMOUS')),
  client_event_id           text not null check (client_event_id ~ '^[A-Za-z0-9_:-]{8,64}$'),
  session_id                text check (session_id is null or session_id ~ '^[A-Za-z0-9_:-]{8,64}$'),
  occurred_at               timestamptz not null,
  recorded_at               timestamptz not null default now(),
  constraint investor_view_not_from_the_future check (occurred_at <= recorded_at + interval '5 minutes'),
  foreign key (investor_organisation_id) references core.investor_organisations (id) on delete restrict
);

comment on table analytics.investor_profile_views is
  'Append-only passive views of an investor''s profile by signed-in participants outside the investor''s firm. Analytics only: never a domain event, never relationship state, never a ranking input, never contact permission. Investors read it only through the aggregating projection.';

create unique index investor_profile_views_client_id_idx
  on analytics.investor_profile_views (tenant_id, viewer_user_id, client_event_id);
create index investor_profile_views_subject_idx
  on analytics.investor_profile_views (investor_organisation_id, occurred_at desc);
create index investor_profile_views_viewer_idx
  on analytics.investor_profile_views (viewer_user_id, occurred_at desc);

-- The same stamp (membership check, visibility from the database) and the
-- same append-only guard as company engagement.
create trigger investor_profile_views_stamp
  before insert on analytics.investor_profile_views
  for each row execute function analytics.stamp_engagement_event();
create trigger investor_profile_views_immutable
  before update or delete on analytics.investor_profile_views
  for each row execute function analytics.protect_engagement_event();

alter table analytics.investor_profile_views enable row level security;
revoke all on analytics.investor_profile_views from public, anon, authenticated;
grant select on analytics.investor_profile_views to authenticated;

create policy investor_profile_views_select_own
  on analytics.investor_profile_views
  for select to authenticated
  using (
    viewer_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

-- ---------------------------------------------------------------------------
-- Projection (server layer: the API passes the actor it resolved).
-- ---------------------------------------------------------------------------

-- An active member of the investor's own organisation, or nobody.
create function analytics.may_read_investor_views(p_actor_user_id uuid, p_investor_organisation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select p_actor_user_id is not null and exists (
    select 1
    from core.investor_organisations io
    join identity.organisation_memberships m
      on m.organisation_id = io.organisation_id
     and m.tenant_id = io.tenant_id
    where io.id = p_investor_organisation_id
      and m.user_id = p_actor_user_id
      and m.membership_status = 'active'
  )
$$;
revoke all on function analytics.may_read_investor_views(uuid, uuid) from public, anon, authenticated;

-- External views in completed batches, each with its week; the investor's
-- own team never counts. No identity leaves this function except to the
-- aggregates below.
create function analytics.investor_external_views(p_actor_user_id uuid, p_investor_organisation_id uuid, p_since timestamptz)
  returns table (viewer_user_id uuid, viewer_organisation_id uuid, period_start date)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select v.viewer_user_id, v.viewer_organisation_id,
         date_trunc(analytics.passive_period_unit(), v.occurred_at)::date
    from analytics.investor_profile_views v
    join core.investor_organisations io on io.id = v.investor_organisation_id
   where v.investor_organisation_id = p_investor_organisation_id
     and analytics.may_read_investor_views(p_actor_user_id, p_investor_organisation_id)
     and v.occurred_at >= coalesce(p_since, '-infinity'::timestamptz)
     and v.occurred_at < date_trunc(analytics.passive_period_unit(), now())
     and v.viewer_organisation_id <> io.organisation_id
$$;
revoke all on function analytics.investor_external_views(uuid, uuid, timestamptz) from public, anon, authenticated;

-- One row per completed batch, withheld below the headline floor.
create function analytics.investor_viewing_periods(p_actor_user_id uuid, p_investor_organisation_id uuid, p_since timestamptz)
  returns table (period_start date, organisations integer, viewers integer, profile_views integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select x.period_start,
         count(distinct x.viewer_organisation_id)::integer,
         count(distinct x.viewer_user_id)::integer,
         count(*)::integer
    from analytics.investor_external_views(p_actor_user_id, p_investor_organisation_id, p_since) x
   group by 1
  having count(distinct x.viewer_organisation_id) >= analytics.engagement_floor()
   order by 1
$$;
revoke all on function analytics.investor_viewing_periods(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Breakdowns by the viewing company's stage and country, over the whole
-- window, only when the window meets the headline floor; each slice needs
-- the slice floor, and when exactly one slice of a dimension is hidden the
-- next-smallest is hidden too (complementary suppression).
create function analytics.investor_viewing_slices(p_actor_user_id uuid, p_investor_organisation_id uuid, p_since timestamptz)
  returns table (dimension text, slice text, organisations integer, suppressed boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with views as (
    select * from analytics.investor_external_views(p_actor_user_id, p_investor_organisation_id, p_since)
  ),
  orgs as (
    select distinct v.viewer_organisation_id as organisation_id
      from views v
     where (select count(distinct w.viewer_organisation_id) from views w) >= analytics.engagement_floor()
  ),
  attributes as (
    select o.organisation_id,
           coalesce(p.stage_code, case when c.id is null then 'NOT_A_COMPANY' else 'UNKNOWN' end) as stage,
           coalesce(c.headquarters_country, 'UNKNOWN') as geography
      from orgs o
      left join core.companies c on c.organisation_id = o.organisation_id
      left join knowledge.company_profiles p on p.company_id = c.id
  ),
  cells as (
    select 'STAGE'::text as dimension, a.stage as slice, count(*)::integer as n
      from attributes a group by 2
    union all
    select 'GEOGRAPHY', a.geography, count(*)::integer from attributes a group by 2
  ),
  marked as (
    select c.*, c.n < analytics.slice_floor() as primary_hidden,
           count(*) filter (where c.n < analytics.slice_floor()) over (partition by c.dimension) as hidden_in_dimension,
           row_number() over (partition by c.dimension, c.n < analytics.slice_floor() order by c.n, c.slice) as rank_in_group
      from cells c
  ),
  decided as (
    select m.dimension, m.slice, m.n,
           m.primary_hidden or (m.hidden_in_dimension = 1 and m.rank_in_group = 1) as hidden
      from marked m
  )
  select r.dimension, r.slice, r.organisations, r.suppressed
    from (
      select d.dimension, d.slice, d.n as organisations, false as suppressed
        from decided d where not d.hidden
      union all
      select d.dimension, 'OTHER', null::integer, true
        from decided d where d.hidden
       group by d.dimension
    ) r
   order by r.dimension, r.suppressed, r.organisations desc nulls last, r.slice
$$;
revoke all on function analytics.investor_viewing_slices(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authenticated wrappers: the actor is the signed-in person.
-- ---------------------------------------------------------------------------

create function analytics.my_investor_viewing_periods(p_investor_organisation_id uuid, p_since timestamptz default null)
  returns table (period_start date, organisations integer, viewers integer, profile_views integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.investor_viewing_periods((select private.current_app_user_id()), p_investor_organisation_id, p_since) $$;

create function analytics.my_investor_viewing_slices(p_investor_organisation_id uuid, p_since timestamptz default null)
  returns table (dimension text, slice text, organisations integer, suppressed boolean)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.investor_viewing_slices((select private.current_app_user_id()), p_investor_organisation_id, p_since) $$;

revoke all on function analytics.my_investor_viewing_periods(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_investor_viewing_slices(uuid, timestamptz) from public, anon;
grant execute on function analytics.my_investor_viewing_periods(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_investor_viewing_slices(uuid, timestamptz) to authenticated;
