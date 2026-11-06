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
-- What the founder is SHOWN also follows the admin settings in
-- analytics.platform_settings (spec defaults: named passive viewers OFF, so a
-- Full identity viewer appears as their organisation; paid reveal OFF;
-- overriding Anonymous NO; per-person time OFF).
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

-- Paid identity reveal is a plan feature (owner, 6 Nov 2026), off in every
-- plan until billing includes it, and inert unless the admin setting
-- paid_identity_reveal is also on.
insert into billing.features (key, name, description, kind, unit_singular, unit_plural) values
  ('analytics.identity_reveal', 'Viewer identity reveal',
   'See the people behind views of your company where the platform allows it. Never overrides an investor''s Anonymous choice unless the platform explicitly allows that.',
   'ACCESS', 'reveal', 'reveals');

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

-- Events about one company from outside its own team. Each carries:
--   effective_visibility  the viewer's own level: the more private of the
--                         level at view time and their current one;
--   display_visibility    what the founder is shown, after the admin
--                         settings (named_passive_viewers, paid reveal);
--   basis                 VIEWER_CHOICE, or PAID_REVEAL where the display is
--                         less private than the viewer's own level.
-- Anonymous stays anonymous unless paid reveal is on, the company is
-- entitled to it AND the admin allowed overriding Anonymous.
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
    occurred_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with company as (
    select c.id, c.tenant_id, c.organisation_id,
           st.named_passive_viewers as named,
           st.paid_reveal_overrides_anonymous as override_anonymous,
           (st.paid_identity_reveal and analytics.organisation_has_identity_reveal(c.organisation_id)) as reveal
      from core.companies c
      cross join analytics.settings() st
     where c.id = p_company_id
       and analytics.may_read_company_engagement(p_actor_user_id, p_company_id)
  ),
  levels as (
    select e.*, company.named, company.reveal, company.override_anonymous,
           case greatest(
             analytics.visibility_rank(e.visibility_at_view),
             analytics.visibility_rank(coalesce(s.visibility, analytics.default_viewing_visibility())))
             when 0 then 'FULL_IDENTITY' when 1 then 'ORGANISATION_ONLY' else 'ANONYMOUS' end as eff
      from analytics.engagement_events e
      join company on company.id = e.company_id and company.tenant_id = e.company_tenant_id
      left join analytics.viewing_privacy_settings s on s.user_id = e.viewer_user_id
     where e.occurred_at >= coalesce(p_since, '-infinity'::timestamptz)
       and e.viewer_organisation_id <> company.organisation_id
  ),
  shown as (
    select l.*,
           case
             when l.eff = 'ANONYMOUS' then
               case when l.reveal and l.override_anonymous then 'FULL_IDENTITY' else 'ANONYMOUS' end
             when l.reveal then 'FULL_IDENTITY'
             when l.eff = 'FULL_IDENTITY' and l.named then 'FULL_IDENTITY'
             else 'ORGANISATION_ONLY'
           end as display
      from levels l
  )
  select x.viewer_user_id, x.viewer_organisation_id, x.eff, x.display,
         case when analytics.visibility_rank(x.display) < analytics.visibility_rank(x.eff)
              then 'PAID_REVEAL' else 'VIEWER_CHOICE' end,
         x.engagement_type, x.document_id, x.slide_number, x.media_asset_id,
         x.duration_ms, x.max_position_ms, x.media_duration_ms, x.occurred_at
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
-- Viewers, at the level each is shown (A2 + admin settings).
-- ---------------------------------------------------------------------------

create function analytics.company_engagement_viewers(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    visibility text,
    basis text,
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
      x.display_visibility as visibility,
      x.basis,
      case when x.display_visibility = 'FULL_IDENTITY' then x.viewer_user_id end as shown_user,
      case when x.display_visibility in ('FULL_IDENTITY', 'ORGANISATION_ONLY') then x.viewer_organisation_id end as shown_org,
      x.viewer_user_id as hidden_user,
      x.viewer_organisation_id as hidden_org,
      x.engagement_type, x.duration_ms, x.occurred_at
    from analytics.company_external_events(p_actor_user_id, p_company_id, p_since) x
  ),
  granular as (select (analytics.settings()).per_person_passive_analytics as on_)
  select
    r.visibility,
    r.basis,
    r.shown_user,
    r.shown_org,
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
    -- An anonymous bucket carries no time: a timestamp is enough to
    -- re-identify a single quiet viewer.
    case when r.visibility = 'ANONYMOUS' then null else max(r.occurred_at) end
  from redacted r
  group by r.visibility, r.basis, r.shown_user, r.shown_org
  having r.visibility <> 'ANONYMOUS'
      or count(distinct r.hidden_org) >= analytics.engagement_floor()
  order by analytics.visibility_rank(r.visibility), max(r.occurred_at) desc
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

create function analytics.my_company_engagement_daily(p_company_id uuid, p_since timestamptz default null)
  returns table (day date, viewers integer, profile_views integer, deck_opens integer,
                 video_watches integer, q_card_views integer, data_room_document_views integer)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_engagement_daily((select private.current_app_user_id()), p_company_id, p_since) $$;

create function analytics.my_company_engagement_viewers(p_company_id uuid, p_since timestamptz default null)
  returns table (visibility text, basis text, viewer_user_id uuid, viewer_organisation_id uuid, people integer,
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
