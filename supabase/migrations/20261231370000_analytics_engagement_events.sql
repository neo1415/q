-- Q Workspace §8 A1 + A2 · analytics.engagement_events and the viewer's
-- viewing-privacy setting (Product Specification §6.7.12-6.7.14).
--
--   ANALYTICS ≠ DOMAIN EVENT: nothing here is relationship truth, nothing
--   here publishes to the outbox, and nothing here is a ranking input.
--   viewing ≠ interest;  viewing ≠ contact permission
--
-- Two tables:
--
--   analytics.engagement_events            what a signed-in participant
--     looked at on a company's profile, deck, video, Q Card or data room,
--     and for how long. Append-only. Owned by the VIEWER's tenant: the
--     behaviour is the viewer's own, and the subject company's founders
--     never read a row here directly.
--
--   analytics.viewing_privacy_settings     how identifiable a person chooses
--     to be when they look (§6.7.13): FULL_IDENTITY, ORGANISATION_ONLY or
--     ANONYMOUS. A person without a row gets analytics.default_viewing_
--     visibility(), the one config value for the default.
--
-- The visibility in force when a view happened is stamped on the event by
-- the database, never taken from a client. The founder-facing projection
-- (next migration) applies the more private of that stamp and the viewer's
-- current setting, so turning anonymity on hides the past and turning it
-- off never reveals it.

create schema if not exists analytics;
revoke all on schema analytics from public;
grant usage on schema analytics to authenticated;

-- ---------------------------------------------------------------------------
-- The default (A2). One value, here, and nowhere else in SQL. The TypeScript
-- mirror (DEFAULT_VIEWING_VISIBILITY) is display-only; this is enforcement.
-- ---------------------------------------------------------------------------

create function analytics.default_viewing_visibility()
  returns text
  language sql
  immutable
  set search_path = ''
as $$ select 'ORGANISATION_ONLY'::text $$;
revoke all on function analytics.default_viewing_visibility() from public;
grant execute on function analytics.default_viewing_visibility() to authenticated;

-- ---------------------------------------------------------------------------
-- Viewing privacy (§6.7.13).
-- ---------------------------------------------------------------------------

create table analytics.viewing_privacy_settings (
  user_id      uuid primary key references identity.user_profiles (id) on delete restrict,
  visibility   text not null check (visibility in ('FULL_IDENTITY', 'ORGANISATION_ONLY', 'ANONYMOUS')),
  updated_at   timestamptz not null default now()
);

comment on table analytics.viewing_privacy_settings is
  'A person''s own choice of how identifiable they are when viewing a company (Product Specification §6.7.13). Absence means analytics.default_viewing_visibility().';

-- ---------------------------------------------------------------------------
-- Events.
-- ---------------------------------------------------------------------------

create table analytics.engagement_events (
  id                      uuid primary key default gen_random_uuid(),
  -- The viewer's tenant and organisation, resolved by the server from the
  -- actor context and checked against an active membership below.
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  viewer_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  viewer_organisation_id  uuid not null,
  -- The subject, with its own tenant, so a projection can never join across
  -- the wrong tenant by accident.
  company_id              uuid not null,
  company_tenant_id       uuid not null,

  engagement_type         text not null check (engagement_type in (
                            'PROFILE_VIEW', 'DECK_OPEN', 'DECK_SLIDE_DWELL', 'VIDEO_WATCH',
                            'Q_CARD_VIEW', 'DATA_ROOM_DOCUMENT_VIEW')),
  engagement_version      text not null check (engagement_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),

  -- A deck or a data-room document belongs to the company's tenant (FK below).
  document_id             uuid,
  slide_number            integer check (slide_number is null or slide_number between 1 and 500),
  media_asset_id          uuid,
  -- Watched / dwelt time for this event. Bounded: a tab left open overnight
  -- is not six hours of attention, and the client caps before sending.
  duration_ms             integer check (duration_ms is null or duration_ms between 0 and 3600000),
  -- For video completion: the furthest position reached and the asset length.
  max_position_ms         integer check (max_position_ms is null or max_position_ms between 0 and 86400000),
  media_duration_ms       integer check (media_duration_ms is null or media_duration_ms between 1 and 86400000),

  -- Stamped by trigger from the viewer's setting at insert. Never client input.
  visibility_at_view      text not null check (visibility_at_view in ('FULL_IDENTITY', 'ORGANISATION_ONLY', 'ANONYMOUS')),

  client_event_id         text not null check (client_event_id ~ '^[A-Za-z0-9_:-]{8,64}$'),
  session_id              text check (session_id is null or session_id ~ '^[A-Za-z0-9_:-]{8,64}$'),
  occurred_at             timestamptz not null,
  recorded_at             timestamptz not null default now(),

  constraint engagement_document_shape check (
    (engagement_type in ('DECK_OPEN', 'DECK_SLIDE_DWELL', 'DATA_ROOM_DOCUMENT_VIEW')) = (document_id is not null)
  ),
  constraint engagement_slide_shape check (
    (engagement_type = 'DECK_SLIDE_DWELL') = (slide_number is not null)
  ),
  constraint engagement_dwell_has_duration check (
    engagement_type <> 'DECK_SLIDE_DWELL' or duration_ms is not null
  ),
  constraint engagement_video_shape check (
    (engagement_type = 'VIDEO_WATCH') = (media_asset_id is not null)
    and (engagement_type <> 'VIDEO_WATCH' or duration_ms is not null)
    and (max_position_ms is null or engagement_type = 'VIDEO_WATCH')
    and (media_duration_ms is null or engagement_type = 'VIDEO_WATCH')
  ),
  constraint engagement_not_from_the_future check (occurred_at <= recorded_at + interval '5 minutes'),

  foreign key (company_id, company_tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  foreign key (document_id, company_tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (media_asset_id, company_tenant_id)
    references media.media_assets (id, tenant_id) on delete restrict
);

comment on table analytics.engagement_events is
  'Append-only passive engagement by signed-in participants with a company (profile, deck, slides, video, Q Card, data room). Analytics only: never a domain event, never relationship state, never a ranking input, never contact permission. Founders read it only through the redacting projection.';
comment on column analytics.engagement_events.visibility_at_view is
  'The viewer''s viewing-privacy setting when the view happened, stamped by the database.';

-- Retry-safe: the same logical event from the same person is one row.
create unique index engagement_events_client_id_idx
  on analytics.engagement_events (tenant_id, viewer_user_id, client_event_id);
-- The founder projection: one company over time.
create index engagement_events_company_idx
  on analytics.engagement_events (company_id, occurred_at desc);
-- The viewer's own history (A4).
create index engagement_events_viewer_idx
  on analytics.engagement_events (viewer_user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Integrity: the viewer really belongs to the organisation and tenant the
-- row names, and the visibility comes from the database, not the caller.
-- ---------------------------------------------------------------------------

create function analytics.stamp_engagement_event()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not exists (
    select 1
    from identity.organisation_memberships m
    where m.user_id = new.viewer_user_id
      and m.organisation_id = new.viewer_organisation_id
      and m.tenant_id = new.tenant_id
      and m.membership_status = 'active'
  ) then
    raise exception 'engagement viewer is not an active member of the named organisation'
      using errcode = 'check_violation';
  end if;

  new.visibility_at_view := coalesce(
    (select s.visibility from analytics.viewing_privacy_settings s where s.user_id = new.viewer_user_id),
    analytics.default_viewing_visibility()
  );
  new.recorded_at := now();
  return new;
end;
$$;
revoke all on function analytics.stamp_engagement_event() from public;

create trigger engagement_events_stamp
  before insert on analytics.engagement_events
  for each row execute function analytics.stamp_engagement_event();

create function analytics.protect_engagement_event()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception 'analytics.engagement_events is append-only'
    using errcode = 'restrict_violation';
end;
$$;
revoke all on function analytics.protect_engagement_event() from public;

create trigger engagement_events_immutable
  before update or delete on analytics.engagement_events
  for each row execute function analytics.protect_engagement_event();

-- ---------------------------------------------------------------------------
-- RLS. Writes are server-only (the API resolves identity). A signed-in
-- person may read their OWN events and setting while their membership of
-- the owning tenant is active; nobody reads anyone else's. Founders reach
-- engagement only through the projection functions.
-- ---------------------------------------------------------------------------

alter table analytics.engagement_events enable row level security;
alter table analytics.viewing_privacy_settings enable row level security;

revoke all on analytics.engagement_events from public, anon, authenticated;
revoke all on analytics.viewing_privacy_settings from public, anon, authenticated;
grant select on analytics.engagement_events to authenticated;
grant select on analytics.viewing_privacy_settings to authenticated;

create policy engagement_events_select_own
  on analytics.engagement_events
  for select to authenticated
  using (
    viewer_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

create policy viewing_privacy_settings_select_own
  on analytics.viewing_privacy_settings
  for select to authenticated
  using (user_id = (select private.current_app_user_id()));
