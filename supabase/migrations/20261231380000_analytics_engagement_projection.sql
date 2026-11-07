-- Q Workspace §8 A2 + A3 · the founder-facing engagement projection.
--
-- The ONLY way a company's team reads passive engagement. Every identity,
-- floor and batching decision is made here, in SQL, from the admin settings
-- (analytics.settings()), so no application path can show more than the
-- settings and each viewer allow (Product Specification §6.7.12-6.7.14;
-- owner decisions 6 Nov 2026, DECISIONS 72/74).
--
-- A viewer's OWN level is the more private of the level stamped when they
-- viewed and their current one. What the founder is SHOWN:
--
--   entitled founder (paid reveal ON and the plan includes
--   analytics.identity_reveal), or named_passive_viewers ON:
--     FULL_IDENTITY       by name, one row per person
--     ORGANISATION_ONLY   by organisation, people merged
--     ANONYMOUS           "an investor": merged, no organisation, no time
--   otherwise (a free plan): one merged AGGREGATE row, no identity at all.
--
--   Only paid_reveal_overrides_anonymous (OFF, locked) ever names an
--   Anonymous viewer, and only to an entitled founder (basis PAID_REVEAL).
--
-- Floors: no passive total below headline_floor distinct organisations
-- (min 3); no breakdown slice below slice_floor (min 5), with complementary
-- suppression. Merged rows need the headline floor themselves.
-- Batching: passive figures cover completed periods only (WEEKLY by
-- default) and carry the period, never a per-view time.
--
-- Viewing is not contact permission (§6.7.14): nothing here returns a way to
-- reach a viewer, and the company's own team is never counted.
--
-- Two layers:
--   analytics.company_*(p_actor_user_id, ...)   server only; the API passes
--     the actor it resolved. Not executable by any client role.
--   analytics.my_company_*(...)                 authenticated; the actor is
--     always private.current_app_user_id(), never an argument.
-- Both require an ACTIVE membership of the company's organisation and
-- return nothing otherwise, the same as for a company that does not exist.

-- ---------------------------------------------------------------------------
-- Paid identity reveal: a founder plan feature (subscription, not credits).
-- Founder Pro includes it; Free and Launch do not; investor plans never do,
-- because investors never pay for visibility or anonymity.
-- ---------------------------------------------------------------------------

insert into billing.features (key, name, description, kind, unit_singular, unit_plural) values
  ('analytics.identity_reveal', 'Viewer identity',
   'See who viewed your company at the level each investor chose: their name, their organisation, or "an investor". Never reveals an investor who chose to be anonymous.',
   'ACCESS', 'reveal', 'reveals');

insert into billing.plan_features (plan_id, feature_key, included)
select p.id, 'analytics.identity_reveal', p.key = 'founder_pro'
  from billing.plans p
 where p.key in ('founder_pro', 'free', 'launch', 'investor_pro', 'fund');

-- The same resolution the billing entitlement service uses: the account's
-- current plan (or the launch default), plus any live override.
create function analytics.organisation_has_identity_reveal(p_organisation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with account as (select 'o:' || p_organisation_id::text as key),
  assigned as (
    select a.plan_id
      from billing.plan_assignments a, account
     where a.account_key = account.key
       and a.superseded_at is null
       and a.starts_at <= clock_timestamp()
       and (a.ends_at is null or a.ends_at > clock_timestamp())
     limit 1
  ),
  plan as (
    select plan_id from assigned
    union all
    select p.id from billing.plans p
     where p.is_launch_default and not exists (select 1 from assigned)
  )
  select exists (
           select 1 from billing.limit_overrides o, account
            where o.account_key = account.key
              and o.feature_key = 'analytics.identity_reveal'
              and o.revoked_at is null
              and (o.expires_at is null or o.expires_at > clock_timestamp()))
      or exists (
           select 1 from plan
             join billing.plan_features pf on pf.plan_id = plan.plan_id
            where pf.feature_key = 'analytics.identity_reveal' and pf.included)
$$;
revoke all on function analytics.organisation_has_identity_reveal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

create function analytics.visibility_rank(p_visibility text)
  returns integer
  language sql
  immutable
  set search_path = ''
as $$
  select case p_visibility
    when 'FULL_IDENTITY' then 0
    when 'ORGANISATION_ONLY' then 1
    else 2 -- ANONYMOUS, and anything unrecognised fails private
  end
$$;
revoke all on function analytics.visibility_rank(text) from public;

-- The floors, from the admin settings (never below 3 and 5: the table
-- constraints hold them, and so does greatest() here).
create function analytics.engagement_floor()
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$ select greatest(3, coalesce((analytics.settings()).headline_floor, 3)) $$;
revoke all on function analytics.engagement_floor() from public;
grant execute on function analytics.engagement_floor() to authenticated;

create function analytics.slice_floor()
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$ select greatest(5, coalesce((analytics.settings()).slice_floor, 5)) $$;
revoke all on function analytics.slice_floor() from public;
grant execute on function analytics.slice_floor() to authenticated;

-- The batch unit: passive figures stop at the start of the current batch.
create function analytics.passive_period_unit()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$ select case (analytics.settings()).passive_batch when 'DAILY' then 'day' else 'week' end $$;
revoke all on function analytics.passive_period_unit() from public;

create function analytics.may_read_company_engagement(p_actor_user_id uuid, p_company_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select p_actor_user_id is not null and exists (
    select 1
    from core.companies c
    join identity.organisation_memberships m
      on m.organisation_id = c.organisation_id
     and m.tenant_id = c.tenant_id
    where c.id = p_company_id
      and m.user_id = p_actor_user_id
      and m.membership_status = 'active'
  )
$$;
revoke all on function analytics.may_read_company_engagement(uuid, uuid) from public, anon, authenticated;

-- Whether this company's founders see per-viewer rows, and why.
create function analytics.company_viewer_access(p_actor_user_id uuid, p_company_id uuid)
  returns table (per_viewer boolean, entitled boolean, override_anonymous boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    (r.reveal or st.named_passive_viewers),
    r.reveal,
    (r.reveal and st.paid_reveal_overrides_anonymous)
  from core.companies c
  cross join analytics.settings() st
  cross join lateral (
    select st.paid_identity_reveal and analytics.organisation_has_identity_reveal(c.organisation_id) as reveal
  ) r
  where c.id = p_company_id
    and analytics.may_read_company_engagement(p_actor_user_id, p_company_id)
$$;
revoke all on function analytics.company_viewer_access(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Passive events about one company from outside its own team, in completed
-- batches only, each with:
--   effective_visibility  the viewer's own level;
--   display_visibility    what the founder is shown (AGGREGATE for a founder
--                         without per-viewer access);
--   basis                 VIEWER_CHOICE, or PAID_REVEAL where the override
--                         named an Anonymous viewer;
--   period_start          the batch the view belongs to (never its time).
-- ---------------------------------------------------------------------------

create function analytics.company_external_events(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    viewer_user_id uuid,
    viewer_organisation_id uuid,
    effective_visibility text,
    display_visibility text,
    basis text,
    engagement_type text,
    document_id uuid,
    slide_number integer,
    media_asset_id uuid,
    duration_ms integer,
    max_position_ms integer,
    media_duration_ms integer,
    period_start date
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with company as (
    select c.id, c.tenant_id, c.organisation_id, a.per_viewer, a.override_anonymous,
           analytics.passive_period_unit() as unit
      from core.companies c
      cross join analytics.company_viewer_access(p_actor_user_id, p_company_id) a
     where c.id = p_company_id
  ),
  levels as (
    select e.*, company.per_viewer, company.override_anonymous, company.unit,
           case greatest(
             analytics.visibility_rank(e.visibility_at_view),
             analytics.visibility_rank(coalesce(s.visibility, analytics.default_viewing_visibility())))
             when 0 then 'FULL_IDENTITY' when 1 then 'ORGANISATION_ONLY' else 'ANONYMOUS' end as eff
      from analytics.engagement_events e
      join company on company.id = e.company_id and company.tenant_id = e.company_tenant_id
      left join analytics.viewing_privacy_settings s on s.user_id = e.viewer_user_id
     where e.occurred_at >= coalesce(p_since, '-infinity'::timestamptz)
       -- Completed batches only: the current week is not shown yet.
       and e.occurred_at < date_trunc(company.unit, now())
       and e.viewer_organisation_id <> company.organisation_id
  ),
  shown as (
    select l.*,
           case
             when l.eff = 'ANONYMOUS' and l.override_anonymous then 'FULL_IDENTITY'
             when not l.per_viewer then 'AGGREGATE'
             else l.eff
           end as display
      from levels l
  )
  select x.viewer_user_id, x.viewer_organisation_id, x.eff, x.display,
         case when x.eff = 'ANONYMOUS' and x.display = 'FULL_IDENTITY'
              then 'PAID_REVEAL' else 'VIEWER_CHOICE' end,
         x.engagement_type, x.document_id, x.slide_number, x.media_asset_id,
         x.duration_ms, x.max_position_ms, x.media_duration_ms,
         date_trunc(x.unit, x.occurred_at)::date
    from shown x
$$;
revoke all on function analytics.company_external_events(uuid, uuid, timestamptz) from public, anon, authenticated;

create function analytics.window_meets_floor(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(distinct x.viewer_organisation_id) >= analytics.engagement_floor()
  from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
$$;
revoke all on function analytics.window_meets_floor(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aggregates (no identity), withheld below the headline floor.
-- ---------------------------------------------------------------------------

-- One row per completed batch (week by default); a batch below the floor
-- is withheld on its own too, since a count from one or two is a person.
create function analytics.company_engagement_periods(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    period_start date,
    organisations integer,
    viewers integer,
    profile_views integer,
    deck_opens integer,
    video_watches integer,
    q_card_views integer,
    data_room_document_views integer
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    x.period_start,
    count(distinct x.viewer_organisation_id)::integer,
    count(distinct x.viewer_user_id)::integer,
    count(*) filter (where x.engagement_type = 'PROFILE_VIEW')::integer,
    count(*) filter (where x.engagement_type = 'DECK_OPEN')::integer,
    count(*) filter (where x.engagement_type = 'VIDEO_WATCH')::integer,
    count(*) filter (where x.engagement_type = 'Q_CARD_VIEW')::integer,
    count(*) filter (where x.engagement_type = 'DATA_ROOM_DOCUMENT_VIEW')::integer
  from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  group by 1
  having count(distinct x.viewer_organisation_id) >= analytics.engagement_floor()
  order by 1
$$;
revoke all on function analytics.company_engagement_periods(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Deck funnel: for each slide, how many people reached it and how long they
-- stayed.
create function analytics.company_deck_funnel(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    document_id uuid,
    slide_number integer,
    viewers_reached integer,
    total_dwell_ms bigint,
    median_dwell_ms integer
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with per_viewer as (
    select x.document_id, x.slide_number, x.viewer_user_id, sum(x.duration_ms)::bigint as dwell
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
    where analytics.window_meets_floor(p_actor_user_id, p_company_id, p_since)
      and x.engagement_type = 'DECK_SLIDE_DWELL'
    group by 1, 2, 3
  )
  select
    p.document_id,
    p.slide_number,
    count(*)::integer,
    sum(p.dwell)::bigint,
    (percentile_cont(0.5) within group (order by p.dwell))::integer
  from per_viewer p
  group by 1, 2
  order by 1, 2
$$;
revoke all on function analytics.company_deck_funnel(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Video completion: a person completed a video when the furthest point they
-- reached is at least 90% of its length.
create function analytics.company_video_completion(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    media_asset_id uuid,
    viewers integer,
    total_watch_ms bigint,
    completed_viewers integer
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with per_viewer as (
    select x.media_asset_id, x.viewer_user_id,
           sum(x.duration_ms)::bigint as watched,
           bool_or(x.max_position_ms is not null and x.media_duration_ms is not null
                   and x.max_position_ms >= 0.9 * x.media_duration_ms) as completed
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
    where analytics.window_meets_floor(p_actor_user_id, p_company_id, p_since)
      and x.engagement_type = 'VIDEO_WATCH'
    group by 1, 2
  )
  select p.media_asset_id, count(*)::integer, sum(p.watched)::bigint,
         count(*) filter (where p.completed)::integer
  from per_viewer p
  group by 1
  order by 1
$$;
revoke all on function analytics.company_video_completion(uuid, uuid, timestamptz) from public, anon, authenticated;

create function analytics.company_document_views(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    document_id uuid,
    engagement_type text,
    views integer,
    viewers integer,
    total_ms bigint
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select x.document_id, x.engagement_type, count(*)::integer,
         count(distinct x.viewer_user_id)::integer,
         coalesce(sum(x.duration_ms), 0)::bigint
  from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  where analytics.window_meets_floor(p_actor_user_id, p_company_id, p_since)
    and x.engagement_type in ('DECK_OPEN', 'DATA_ROOM_DOCUMENT_VIEW')
  group by 1, 2
  order by 1, 2
$$;
revoke all on function analytics.company_document_views(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Breakdowns: who viewed, by investor type and by geography. A slice needs
-- slice_floor distinct organisations. Complementary suppression: when only
-- one slice of a dimension is below the floor, the next-smallest is hidden
-- too, so nothing can be found by subtraction. Hidden slices are merged into
-- one OTHER row with no count and no name.
-- ---------------------------------------------------------------------------

create function analytics.company_engagement_slices(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    dimension text,
    slice text,
    organisations integer,
    suppressed boolean
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with orgs as (
    select distinct x.viewer_organisation_id as organisation_id
      from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
     where analytics.window_meets_floor(p_actor_user_id, p_company_id, p_since)
  ),
  attributes as (
    select o.organisation_id,
           coalesce(io.investor_type, 'NOT_AN_INVESTOR') as investor_type,
           coalesce(io.hq_country, 'UNKNOWN') as geography
      from orgs o
      left join core.investor_organisations io on io.organisation_id = o.organisation_id
  ),
  cells as (
    select 'INVESTOR_TYPE'::text as dimension, a.investor_type as slice, count(*)::integer as n
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
revoke all on function analytics.company_engagement_slices(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Viewers, at the level each is shown.
-- ---------------------------------------------------------------------------

create function analytics.company_engagement_viewers(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    visibility text,
    basis text,
    viewer_user_id uuid,
    viewer_organisation_id uuid,
    organisations integer,
    people integer,
    events integer,
    profile_views integer,
    deck_opens integer,
    total_dwell_ms bigint,
    video_watch_ms bigint,
    q_card_views integer,
    data_room_document_views integer,
    last_period_start date
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with redacted as (
    select
      x.display_visibility as visibility,
      x.basis,
      case when x.display_visibility = 'FULL_IDENTITY' then x.viewer_user_id end as shown_user,
      case when x.display_visibility in ('FULL_IDENTITY', 'ORGANISATION_ONLY') then x.viewer_organisation_id end as shown_org,
      x.viewer_user_id as hidden_user,
      x.viewer_organisation_id as hidden_org,
      x.engagement_type, x.duration_ms, x.period_start
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  ),
  granular as (select (analytics.settings()).per_person_passive_analytics as on_)
  select
    r.visibility,
    r.basis,
    r.shown_user,
    r.shown_org,
    count(distinct r.hidden_org)::integer,
    count(distinct r.hidden_user)::integer,
    count(*)::integer,
    count(*) filter (where r.engagement_type = 'PROFILE_VIEW')::integer,
    count(*) filter (where r.engagement_type = 'DECK_OPEN')::integer,
    -- Time per person is granular passive analytics: only for a named
    -- viewer, and only when the admin turned it on.
    case when (select on_ from granular) and r.visibility = 'FULL_IDENTITY'
         then coalesce(sum(r.duration_ms) filter (where r.engagement_type = 'DECK_SLIDE_DWELL'), 0)::bigint end,
    case when (select on_ from granular) and r.visibility = 'FULL_IDENTITY'
         then coalesce(sum(r.duration_ms) filter (where r.engagement_type = 'VIDEO_WATCH'), 0)::bigint end,
    count(*) filter (where r.engagement_type = 'Q_CARD_VIEW')::integer,
    count(*) filter (where r.engagement_type = 'DATA_ROOM_DOCUMENT_VIEW')::integer,
    -- Merged rows carry no period: one quiet viewer is re-identifiable by it.
    case when r.visibility in ('ANONYMOUS', 'AGGREGATE') then null else max(r.period_start) end
  from redacted r
  group by r.visibility, r.basis, r.shown_user, r.shown_org
  having r.visibility not in ('ANONYMOUS', 'AGGREGATE')
      or count(distinct r.hidden_org) >= analytics.engagement_floor()
  order by case r.visibility when 'FULL_IDENTITY' then 0 when 'ORGANISATION_ONLY' then 1
                             when 'ANONYMOUS' then 2 else 3 end,
           max(r.period_start) desc
$$;
revoke all on function analytics.company_engagement_viewers(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Slide dwell per named viewer (beyond spec; admin setting
-- per_person_passive_analytics, default OFF). Empty when off.
create function analytics.company_viewer_deck_detail(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    viewer_user_id uuid,
    document_id uuid,
    slide_number integer,
    dwell_ms bigint
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select x.viewer_user_id, x.document_id, x.slide_number, sum(x.duration_ms)::bigint
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
   where (analytics.settings()).per_person_passive_analytics
     and x.display_visibility = 'FULL_IDENTITY'
     and x.engagement_type = 'DECK_SLIDE_DWELL'
   group by 1, 2, 3
   order by 1, 2, 3
$$;
revoke all on function analytics.company_viewer_deck_detail(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authenticated wrappers: the actor is the signed-in person, never a
-- parameter.
-- ---------------------------------------------------------------------------

create function analytics.my_company_engagement_periods(p_company_id uuid, p_since timestamptz default null)
  returns table (period_start date, organisations integer, viewers integer, profile_views integer,
                 deck_opens integer, video_watches integer, q_card_views integer,
                 data_room_document_views integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_periods((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_engagement_viewers(p_company_id uuid, p_since timestamptz default null)
  returns table (visibility text, basis text, viewer_user_id uuid, viewer_organisation_id uuid,
                 organisations integer, people integer, events integer, profile_views integer,
                 deck_opens integer, total_dwell_ms bigint, video_watch_ms bigint, q_card_views integer,
                 data_room_document_views integer, last_period_start date)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_viewers((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_deck_funnel(p_company_id uuid, p_since timestamptz default null)
  returns table (document_id uuid, slide_number integer, viewers_reached integer,
                 total_dwell_ms bigint, median_dwell_ms integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_deck_funnel((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_engagement_slices(p_company_id uuid, p_since timestamptz default null)
  returns table (dimension text, slice text, organisations integer, suppressed boolean)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_slices((select private.current_app_user_id()), p_company_id, p_since) $$;

revoke all on function analytics.my_company_engagement_periods(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_company_engagement_viewers(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_company_deck_funnel(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_company_engagement_slices(uuid, timestamptz) from public, anon;
grant execute on function analytics.my_company_engagement_periods(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_company_engagement_viewers(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_company_deck_funnel(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_company_engagement_slices(uuid, timestamptz) to authenticated;
