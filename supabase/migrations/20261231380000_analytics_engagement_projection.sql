-- Q Workspace §8 A2 + A3 · the founder-facing engagement projection.
--
-- The ONLY way a company's team reads engagement. Identity is redacted here,
-- in SQL, so no application code path can obtain an identity the viewer did
-- not allow (Product Specification §6.7.13):
--
--   FULL_IDENTITY       person and organisation, one row per person
--   ORGANISATION_ONLY   organisation only, one row per organisation (people
--                       merged, so row counts cannot reveal individuals)
--   ANONYMOUS           one merged row with no identity and no timestamp
--
-- The effective level is the MORE PRIVATE of the level stamped when the view
-- happened and the viewer's current setting.
--
-- Passive aggregates appear only when at least analytics.engagement_floor()
-- distinct organisations engaged in the window (the Results page's floor).
-- Named rows appear because the viewer chose to be named; the anonymous
-- bucket appears only when it spans the floor itself.
--
-- Viewing is not contact permission (§6.7.14): nothing here returns a way
-- to reach a viewer, and the company's own team is never counted.
--
-- Two layers of functions:
--   analytics.company_engagement_*(p_actor_user_id, ...)   server only; the
--     API passes the actor it resolved. Not executable by any client role.
--   analytics.my_company_engagement_*(...)                 authenticated;
--     the actor is always private.current_app_user_id(), never an argument.
-- Both check an ACTIVE membership of the company's organisation and return
-- nothing otherwise, the same as for a company that does not exist.

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

-- The k-anonymity floor for founder-facing passive figures, the same 3 the
-- Results page already uses (packages/results ENGAGEMENT_FLOOR): below 3
-- distinct viewing organisations in the window, aggregates are withheld,
-- because with one or two a count IS a person. One value, here.
create function analytics.engagement_floor()
  returns integer
  language sql
  immutable
  set search_path = ''
as $$ select 3 $$;
revoke all on function analytics.engagement_floor() from public;
grant execute on function analytics.engagement_floor() to authenticated;

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

-- Events about one company from outside its own team, each with its
-- effective (most private) visibility. Internal building block.
create function analytics.company_external_events(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    viewer_user_id uuid,
    viewer_organisation_id uuid,
    effective_visibility text,
    engagement_type text,
    document_id uuid,
    slide_number integer,
    media_asset_id uuid,
    duration_ms integer,
    max_position_ms integer,
    media_duration_ms integer,
    occurred_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    e.viewer_user_id,
    e.viewer_organisation_id,
    case greatest(
      analytics.visibility_rank(e.visibility_at_view),
      analytics.visibility_rank(coalesce(s.visibility, analytics.default_viewing_visibility())))
      when 0 then 'FULL_IDENTITY' when 1 then 'ORGANISATION_ONLY' else 'ANONYMOUS' end,
    e.engagement_type, e.document_id, e.slide_number, e.media_asset_id,
    e.duration_ms, e.max_position_ms, e.media_duration_ms, e.occurred_at
  from analytics.engagement_events e
  join core.companies c on c.id = e.company_id and c.tenant_id = e.company_tenant_id
  left join analytics.viewing_privacy_settings s on s.user_id = e.viewer_user_id
  where analytics.may_read_company_engagement(p_actor_user_id, p_company_id)
    and e.company_id = p_company_id
    and e.occurred_at >= coalesce(p_since, '-infinity'::timestamptz)
    and e.viewer_organisation_id <> c.organisation_id
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
-- Aggregates (no identity at all), withheld below the floor.
-- ---------------------------------------------------------------------------

create function analytics.company_engagement_daily(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    day date,
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
    (x.occurred_at at time zone 'UTC')::date,
    count(distinct x.viewer_user_id)::integer,
    count(*) filter (where x.engagement_type = 'PROFILE_VIEW')::integer,
    count(*) filter (where x.engagement_type = 'DECK_OPEN')::integer,
    count(*) filter (where x.engagement_type = 'VIDEO_WATCH')::integer,
    count(*) filter (where x.engagement_type = 'Q_CARD_VIEW')::integer,
    count(*) filter (where x.engagement_type = 'DATA_ROOM_DOCUMENT_VIEW')::integer
  from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  where analytics.window_meets_floor(p_actor_user_id, p_company_id, p_since)
  group by 1
  order by 1
$$;
revoke all on function analytics.company_engagement_daily(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Deck funnel: for each slide, how many people reached it and how long they
-- stayed. "Opened" is the top of the funnel.
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
-- Viewers, at each viewer's allowed level (A2).
-- ---------------------------------------------------------------------------

create function analytics.company_engagement_viewers(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    visibility text,
    viewer_user_id uuid,
    viewer_organisation_id uuid,
    people integer,
    events integer,
    profile_views integer,
    deck_opens integer,
    total_dwell_ms bigint,
    video_watch_ms bigint,
    q_card_views integer,
    data_room_document_views integer,
    last_viewed_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with redacted as (
    select
      x.effective_visibility as visibility,
      case when x.effective_visibility = 'FULL_IDENTITY' then x.viewer_user_id end as shown_user,
      case when x.effective_visibility in ('FULL_IDENTITY', 'ORGANISATION_ONLY') then x.viewer_organisation_id end as shown_org,
      x.viewer_user_id as hidden_user,
      x.viewer_organisation_id as hidden_org,
      x.engagement_type, x.duration_ms, x.occurred_at
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  )
  select
    r.visibility,
    r.shown_user,
    r.shown_org,
    count(distinct r.hidden_user)::integer,
    count(*)::integer,
    count(*) filter (where r.engagement_type = 'PROFILE_VIEW')::integer,
    count(*) filter (where r.engagement_type = 'DECK_OPEN')::integer,
    coalesce(sum(r.duration_ms) filter (where r.engagement_type = 'DECK_SLIDE_DWELL'), 0)::bigint,
    coalesce(sum(r.duration_ms) filter (where r.engagement_type = 'VIDEO_WATCH'), 0)::bigint,
    count(*) filter (where r.engagement_type = 'Q_CARD_VIEW')::integer,
    count(*) filter (where r.engagement_type = 'DATA_ROOM_DOCUMENT_VIEW')::integer,
    -- An anonymous bucket carries no time: a timestamp is enough to
    -- re-identify a single quiet viewer.
    case when r.visibility = 'ANONYMOUS' then null else max(r.occurred_at) end
  from redacted r
  group by r.visibility, r.shown_user, r.shown_org
  having r.visibility <> 'ANONYMOUS'
      or count(distinct r.hidden_org) >= analytics.engagement_floor()
  order by analytics.visibility_rank(r.visibility), max(r.occurred_at) desc
$$;
revoke all on function analytics.company_engagement_viewers(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authenticated wrappers: the actor is the signed-in person, never a
-- parameter.
-- ---------------------------------------------------------------------------

create function analytics.my_company_engagement_daily(p_company_id uuid, p_since timestamptz default null)
  returns table (day date, viewers integer, profile_views integer, deck_opens integer,
                 video_watches integer, q_card_views integer, data_room_document_views integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_daily((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_engagement_viewers(p_company_id uuid, p_since timestamptz default null)
  returns table (visibility text, viewer_user_id uuid, viewer_organisation_id uuid, people integer,
                 events integer, profile_views integer, deck_opens integer, total_dwell_ms bigint,
                 video_watch_ms bigint, q_card_views integer, data_room_document_views integer,
                 last_viewed_at timestamptz)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_viewers((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_deck_funnel(p_company_id uuid, p_since timestamptz default null)
  returns table (document_id uuid, slide_number integer, viewers_reached integer,
                 total_dwell_ms bigint, median_dwell_ms integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_deck_funnel((select private.current_app_user_id()), p_company_id, p_since) $$;

revoke all on function analytics.my_company_engagement_daily(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_company_engagement_viewers(uuid, timestamptz) from public, anon;
revoke all on function analytics.my_company_deck_funnel(uuid, timestamptz) from public, anon;
grant execute on function analytics.my_company_engagement_daily(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_company_engagement_viewers(uuid, timestamptz) to authenticated;
grant execute on function analytics.my_company_deck_funnel(uuid, timestamptz) to authenticated;
