-- Q's face in Google Meet (owner decision 35, 2026-10-15).
--
-- When Q hosts a booked call, a Tavus stock replica can join the Meet as
-- Q's face and voice, beside the Recall note-taker that keeps the record.
-- The face is paid by the same Tavus Builder account as GateQ and video
-- Rehearsals, so it is bounded by the same shared ledger
-- (20261226150000):
--
--   * product MEETING, keyed to the meeting's organiser (user:<id>), so it
--     uses that person's weekly allowance unless they are a listed tester;
--   * the global monthly safeguard binds it like every other session;
--   * its own hard length, billing.video_allowance_config.meeting_max_seconds
--     (default 600 s, never above 1800 s), fixed when the row is made;
--   * at most meeting_concurrent faces at once across the account (default
--     1; 0 turns faces off) and one per organiser.
--
-- One row per meeting (UNIQUE meeting_id): a retried or overlapping start
-- finds the existing row and never makes a second room. The reservation is
-- made by the AFTER INSERT trigger in the same statement, so a refused
-- reservation means no row and no provider call; the Q API then keeps the
-- Recall bot's own voice (today's behaviour). A row released without a
-- provider request does not count; once Q asked the provider for a room,
-- the elapsed time counts, never less.
--
-- Constraints on the ledger are widened per product: MEETING up to 1800 s
-- (30 billed minutes); GateQ and Rehearsals keep 240 s / 4 minutes, which
-- matches 20261227150000 (video clock from room) whichever lands first.
--
-- Server-only: RLS on, no policy, no browser grant.

alter table billing.video_allowance_config
  add column meeting_max_seconds integer not null default 600
    check (meeting_max_seconds between 60 and 1800),
  add column meeting_concurrent integer not null default 1
    check (meeting_concurrent between 0 and 3);

alter table billing.video_session_reservations
  drop constraint video_session_reservations_product_check,
  add constraint video_session_reservations_product_check
    check (product in ('GATEQ', 'REHEARSAL', 'MEETING')),
  drop constraint video_session_reservations_reserved_seconds_check,
  add constraint video_session_reservations_reserved_seconds_check
    check (reserved_seconds between 1 and case when product = 'MEETING' then 1800 else 240 end),
  drop constraint video_session_reservations_settled_seconds_check,
  add constraint video_session_reservations_settled_seconds_check
    check (settled_seconds between 0 and case when product = 'MEETING' then 1800 else 240 end);

alter table billing.video_usage_ledger
  drop constraint video_usage_ledger_product_check,
  add constraint video_usage_ledger_product_check
    check (product in ('GATEQ', 'REHEARSAL', 'MEETING')),
  drop constraint video_usage_ledger_seconds_check,
  add constraint video_usage_ledger_seconds_check
    check (seconds between 0 and case when product = 'MEETING' then 1800 else 240 end),
  drop constraint video_usage_ledger_billed_minutes_check,
  add constraint video_usage_ledger_billed_minutes_check
    check (billed_minutes between 0 and case when product = 'MEETING' then 30 else 4 end);

-- As 20261226150000, with MEETING bounded by its own configured length.
create or replace function billing.reserve_video_session(
  p_session uuid, p_product text, p_tenant uuid, p_subject text, p_seconds integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  cfg billing.video_allowance_config;
  tester boolean;
  used_week integer;
  used_month integer;
  counted integer;
  longest integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cq-video-allowance', 0));
  if exists (select 1 from billing.video_session_reservations where session_id = p_session) then
    return;
  end if;
  select * into strict cfg from billing.video_allowance_config where id;
  longest := case when p_product = 'MEETING' then cfg.meeting_max_seconds
                  else cfg.max_session_seconds end;
  if p_seconds > longest then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_SESSION_TOO_LONG';
  end if;
  tester := exists (select 1 from billing.video_allowance_testers where subject_key = p_subject);
  if not tester then
    select count(*) into used_week from billing.video_session_reservations
     where subject_key = p_subject and status <> 'RELEASED' and not is_test
       and created_at >= billing.video_week_start(now());
    if used_week >= cfg.weekly_sessions then
      raise exception using errcode = 'P0001', message = 'CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED';
    end if;
  end if;
  select coalesce(sum(billing.video_counted_seconds(
           case when status = 'SETTLED' then settled_seconds else reserved_seconds end)), 0)
    into used_month
    from billing.video_session_reservations
   where status <> 'RELEASED'
     and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  counted := billing.video_counted_seconds(p_seconds);
  if used_month + counted > cfg.monthly_cap_seconds then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_GLOBAL_CAP';
  end if;
  insert into billing.video_session_reservations
    (session_id, product, tenant_id, subject_key, is_test, reserved_seconds)
  values (p_session, p_product, p_tenant, p_subject, tester, p_seconds);
  insert into billing.video_usage_ledger
    (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
  values (p_session, p_product, p_subject, tester, 'RESERVED', p_seconds,
          counted / 60, (counted / 60) * cfg.usd_per_minute);
end;
$$;

-- As 20261227150000, with the clip per product (never under-counted).
create or replace function billing.settle_video_session(p_session uuid, p_seconds integer, p_release boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  r billing.video_session_reservations;
  rate numeric;
  secs integer;
begin
  select * into r from billing.video_session_reservations where session_id = p_session for update;
  -- Sessions from before this ledger, or already settled: nothing to do.
  if not found or r.status <> 'RESERVED' then
    return;
  end if;
  secs := least(greatest(coalesce(p_seconds, 0), 0),
                case when r.product = 'MEETING' then 1800 else 240 end);
  select usd_per_minute into rate from billing.video_allowance_config where id;
  if p_release then
    update billing.video_session_reservations
       set status = 'RELEASED', settled_at = clock_timestamp()
     where session_id = p_session;
    insert into billing.video_usage_ledger
      (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
    values (p_session, r.product, r.subject_key, r.is_test, 'RELEASED', 0, 0, 0);
  else
    update billing.video_session_reservations
       set status = 'SETTLED', settled_seconds = secs, settled_at = clock_timestamp()
     where session_id = p_session;
    insert into billing.video_usage_ledger
      (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
    values (p_session, r.product, r.subject_key, r.is_test, 'SETTLED', secs,
            billing.video_counted_seconds(secs) / 60,
            (billing.video_counted_seconds(secs) / 60) * rate);
  end if;
end;
$$;

create table communication.meeting_face_sessions (
  id                           uuid primary key,
  tenant_id                    uuid not null,
  meeting_id                   uuid not null unique,
  organiser_user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  -- The Tavus stock face used, from server configuration (never a likeness
  -- of anyone in the call).
  face_id                      text not null check (face_id ~ '^r[0-9a-f]{6,40}$'),
  -- SHA-256 of the per-session bridge bearer; the bearer is never stored.
  bridge_token_hash            text not null check (bridge_token_hash ~ '^[0-9a-f]{64}$'),
  pal_id                       text check (pal_id ~ '^[A-Za-z0-9_-]{4,128}$'),
  provider_conversation_id     text check (provider_conversation_id ~ '^[A-Za-z0-9_-]{4,128}$'),
  provider_request_started_at  timestamptz,
  status                       text not null default 'STARTING'
                                 check (status in ('STARTING', 'LIVE', 'ENDED', 'FAILED')),
  ended_reason                 text check (ended_reason in
                                 ('CALL_ENDED', 'TIME_LIMIT', 'REMOVED', 'PROVIDER_FAILED', 'RESTARTED')),
  created_at                   timestamptz not null default clock_timestamp(),
  ends_at                      timestamptz not null,
  ended_at                     timestamptz,
  check (ends_at > created_at and ends_at <= created_at + interval '1800 seconds'),
  check ((status in ('ENDED', 'FAILED')) = (ended_at is not null)),
  check ((status in ('ENDED', 'FAILED')) = (ended_reason is not null)),
  check (status <> 'LIVE' or provider_conversation_id is not null),
  foreign key (meeting_id, tenant_id)
    references communication.meetings (id, tenant_id) on delete restrict
);
create index meeting_face_sessions_open_idx
  on communication.meeting_face_sessions (status) where status in ('STARTING', 'LIVE');

-- Concurrency and immutability: who, which meeting, which face and the
-- clock never change; a row moves forward only.
create function communication.meeting_face_sessions_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  cap integer;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('cq-meeting-face', 0));
    -- The meeting already has its face: UNIQUE (meeting_id) answers (ON
    -- CONFLICT DO NOTHING for the Q API's idempotent start).
    if exists (select 1 from communication.meeting_face_sessions where meeting_id = new.meeting_id) then
      return new;
    end if;
    select meeting_concurrent into strict cap from billing.video_allowance_config where id;
    if (select count(*) from communication.meeting_face_sessions
         where status in ('STARTING', 'LIVE')) >= cap
       or exists (select 1 from communication.meeting_face_sessions
                   where status in ('STARTING', 'LIVE') and organiser_user_id = new.organiser_user_id) then
      raise exception using errcode = 'P0001', message = 'CQ_VIDEO_CONCURRENCY_LIMIT';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.meeting_id is distinct from old.meeting_id
     or new.organiser_user_id is distinct from old.organiser_user_id
     or new.face_id is distinct from old.face_id
     or new.bridge_token_hash is distinct from old.bridge_token_hash
     or new.created_at is distinct from old.created_at
     or new.ends_at is distinct from old.ends_at
     or old.status in ('ENDED', 'FAILED')
     or (old.status = 'LIVE' and new.status = 'STARTING') then
    raise exception 'a meeting face session keeps its meeting, face and clock, and only moves forward'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger meeting_face_sessions_guard
  before insert or update on communication.meeting_face_sessions
  for each row execute function communication.meeting_face_sessions_guard();

create function communication.meeting_face_session_reserve()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform billing.reserve_video_session(
    new.id, 'MEETING', new.tenant_id, 'user:' || new.organiser_user_id::text,
    ceil(extract(epoch from (new.ends_at - new.created_at)))::integer);
  return null;
end;
$$;
create trigger meeting_face_session_reserve
  after insert on communication.meeting_face_sessions
  for each row execute function communication.meeting_face_session_reserve();

create function communication.meeting_face_session_settle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Once the provider was asked for a room, the face may have run: count
  -- the elapsed time up to the hard length. Released only when it never was.
  perform billing.settle_video_session(
    new.id,
    least(ceil(extract(epoch from (new.ends_at - new.created_at)))::integer,
          ceil(extract(epoch from (new.ended_at - new.created_at)))::integer),
    new.provider_request_started_at is null);
  return null;
end;
$$;
create trigger meeting_face_session_settle
  after update of status on communication.meeting_face_sessions
  for each row when (new.status in ('ENDED', 'FAILED') and old.status not in ('ENDED', 'FAILED'))
  execute function communication.meeting_face_session_settle();

alter table communication.meeting_face_sessions enable row level security;
revoke all on communication.meeting_face_sessions from public, anon, authenticated;
grant select, insert, update on communication.meeting_face_sessions to postgres, service_role;
revoke all on function
  communication.meeting_face_sessions_guard(),
  communication.meeting_face_session_reserve(),
  communication.meeting_face_session_settle(),
  billing.reserve_video_session(uuid, text, uuid, text, integer),
  billing.settle_video_session(uuid, integer, boolean)
  from public, anon, authenticated;
