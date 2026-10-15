-- The founder's three minutes start when the interviewer is in the room,
-- for GateQ and Rehearsals alike (live runs 2026-10-15: GateQ
-- ga_60g4gydh0q9nscrsnj6wf6q5nc left 167 s, rehearsal 22c3cc68 163 s).
--
-- 20261226160000 started the clock when the provider answered the create
-- call. The interviewer's face then took another 13 s to join, so the
-- founder had 167 s of the 180. The provider tells us when its replica has
-- joined (its system.replica_joined callback), and that is now the start:
--
--   room_ready_at  the provider answered and the room is joinable (LIVE).
--                  The end is provisional: ready + 30 s join grace + cap,
--                  which is also the hard stop.
--   live_at        Q is in the room (callback, or Q's first heard line).
--                  It may only fall inside the grace, and the end becomes
--                  live_at + cap, so it only ever moves earlier.
--
-- A callback that never arrives costs the founder nothing and the provider
-- at most cap + grace: the provisional end already is the hard stop. The
-- provider's own max_call_duration is cap + grace too (the API adapter).
--
-- events_token_hash is the SHA-256 of the per-session secret in the
-- provider's callback URL; the secret itself is never stored.
--
-- Billing never under-counts: a GateQ session may now run cap + grace
-- (210 s), so the ledger's 180 s ceilings rise to 240 s and its minute
-- ceiling to 4. Rehearsals already settle their elapsed seconds; the
-- ledger no longer clips them at 180.

alter table gateq.application_video_sessions
  add column room_ready_at timestamptz,
  add column events_token_hash text check (events_token_hash ~ '^[0-9a-f]{64}$');
create unique index application_video_sessions_events_token_idx
  on gateq.application_video_sessions (events_token_hash)
  where events_token_hash is not null;

alter table gateq.application_video_sessions drop constraint application_video_sessions_clock;
alter table gateq.application_video_sessions
  add constraint application_video_sessions_clock check (
    ends_at > created_at
    and (room_ready_at is null or room_ready_at >= created_at)
    and (live_at is null or (live_at >= created_at
                             and live_at <= created_at + make_interval(secs => max_seconds)))
    and (live_at is null or room_ready_at is null
         or (live_at >= room_ready_at and live_at <= room_ready_at + interval '30 seconds'))
    and ends_at <= coalesce(live_at, room_ready_at + interval '30 seconds', created_at)
                   + make_interval(secs => max_seconds));

create or replace function gateq.protect_application_video_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.application_id is distinct from old.application_id
    or new.created_at is distinct from old.created_at
    or (new.ends_at is distinct from old.ends_at
        and not (
          -- Before 20261227140000: ready was the start (kept for a rolling deploy).
          (old.status = 'STARTING' and new.status = 'LIVE'
           and old.live_at is null and new.live_at is not null and new.room_ready_at is null
           and new.ends_at = new.live_at + make_interval(secs => new.max_seconds))
          -- The room is joinable: the provisional end, which is the hard stop.
          or (old.status = 'STARTING' and new.status = 'LIVE'
              and old.room_ready_at is null and new.room_ready_at is not null
              and new.live_at is null
              and new.ends_at = new.room_ready_at + interval '30 seconds'
                                + make_interval(secs => new.max_seconds))
          -- Q is in the room: the cap from now (never later than the stop).
          or (old.status = 'LIVE' and new.status = 'LIVE'
              and old.room_ready_at is not null and old.live_at is null
              and new.live_at is not null
              and new.ends_at = new.live_at + make_interval(secs => new.max_seconds))))
    or (old.live_at is not null and new.live_at is distinct from old.live_at)
    or (old.room_ready_at is not null and new.room_ready_at is distinct from old.room_ready_at)
    or (old.status = 'STARTING' and old.live_at is null and old.room_ready_at is null
        and new.live_at is not null and new.room_ready_at is not null)
    or new.events_token_hash is distinct from old.events_token_hash
    or new.max_seconds is distinct from old.max_seconds
    or new.bridge_token_hash is distinct from old.bridge_token_hash
    or new.guest_credential_sealed is distinct from old.guest_credential_sealed
    or (old.provider_conversation_id is not null
        and new.provider_conversation_id is distinct from old.provider_conversation_id)
    or (old.status = 'ENDED' and new.status is distinct from 'ENDED') then
    raise exception 'a video session''s identity, clock and end are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.protect_application_video_session() from public, anon, authenticated;

-- The ledger's ceilings: cap + grace, rounded up to whole minutes.
alter table billing.video_session_reservations
  drop constraint video_session_reservations_settled_seconds_check,
  add constraint video_session_reservations_settled_seconds_check
    check (settled_seconds between 0 and 240);
alter table billing.video_usage_ledger
  drop constraint video_usage_ledger_seconds_check,
  add constraint video_usage_ledger_seconds_check check (seconds between 0 and 240),
  drop constraint video_usage_ledger_billed_minutes_check,
  add constraint video_usage_ledger_billed_minutes_check check (billed_minutes between 0 and 4);

create or replace function billing.settle_video_session(p_session uuid, p_seconds integer, p_release boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  r billing.video_session_reservations;
  rate numeric;
  secs integer := least(greatest(coalesce(p_seconds, 0), 0), 240);
begin
  select * into r from billing.video_session_reservations where session_id = p_session for update;
  -- Sessions from before this ledger, or already settled: nothing to do.
  if not found or r.status <> 'RESERVED' then
    return;
  end if;
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

-- GateQ settles what the provider may have run: from allocation, at most
-- cap + grace (the provider's own max_call_duration).
create or replace function gateq.video_session_settle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A failed start with a provider room (made, then not saved as live)
  -- may run until the provider's own cap: count it in full, never less.
  perform billing.settle_video_session(
    new.id,
    case when new.ended_reason = 'PROVIDER_FAILED' then least(new.max_seconds, 180) + 30
         else least(least(new.max_seconds, 180) + 30,
                    ceil(extract(epoch from (new.ended_at - new.created_at)))::integer) end,
    new.ended_reason = 'PROVIDER_FAILED' and new.provider_conversation_id is null);
  return null;
end;
$$;

-- Rehearsals: the same two steps, with the fixed 180 s cap.
alter table q_runtime.rehearsal_video_sessions
  add column room_ready_at timestamptz,
  add column events_token_hash text check (events_token_hash ~ '^[0-9a-f]{64}$');
create unique index rehearsal_video_sessions_events_token_idx
  on q_runtime.rehearsal_video_sessions (events_token_hash)
  where events_token_hash is not null;

alter table q_runtime.rehearsal_video_sessions drop constraint rehearsal_video_sessions_clock;
alter table q_runtime.rehearsal_video_sessions
  add constraint rehearsal_video_sessions_clock check (
    ends_at > created_at
    and (room_ready_at is null or room_ready_at >= created_at)
    and (live_at is null or (live_at >= created_at and live_at <= created_at + interval '180 seconds'))
    and (live_at is null or room_ready_at is null
         or (live_at >= room_ready_at and live_at <= room_ready_at + interval '30 seconds'))
    and ends_at <= coalesce(live_at, room_ready_at + interval '30 seconds', created_at)
                   + interval '180 seconds');

create or replace function q_runtime.rehearsal_video_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ends_at <> old.ends_at
     and not (
       -- Before 20261227140000: ready was the start (kept for a rolling deploy).
       (old.status = 'STARTING' and new.status = 'LIVE'
        and old.live_at is null and new.live_at is not null and new.room_ready_at is null
        and new.ends_at = new.live_at + interval '180 seconds')
       -- The room is joinable: the provisional end, which is the hard stop.
       or (old.status = 'STARTING' and new.status = 'LIVE'
           and old.room_ready_at is null and new.room_ready_at is not null
           and new.live_at is null
           and new.ends_at = new.room_ready_at + interval '210 seconds')
       -- The interviewer is in the room: 180 s from then.
       or (old.status = 'LIVE' and new.status = 'LIVE'
           and old.room_ready_at is not null and old.live_at is null
           and new.live_at is not null
           and new.ends_at = new.live_at + interval '180 seconds')) then
    raise exception 'a video session keeps its owner, rehearsal, token and cap'
      using errcode = '23514';
  end if;
  if old.live_at is not null and new.live_at is distinct from old.live_at then
    raise exception 'a video session''s ready time never moves'
      using errcode = '23514';
  end if;
  if (old.room_ready_at is not null and new.room_ready_at is distinct from old.room_ready_at)
     or new.events_token_hash is distinct from old.events_token_hash then
    raise exception 'a video session keeps its room time and callback secret'
      using errcode = '23514';
  end if;
  if new.created_at <> old.created_at
     or new.tenant_id <> old.tenant_id
     or new.user_id <> old.user_id
     or new.rehearsal_id <> old.rehearsal_id
     or new.bridge_token_hash <> old.bridge_token_hash then
    raise exception 'a video session keeps its owner, rehearsal, token and cap'
      using errcode = '23514';
  end if;
  if old.status in ('ENDED', 'FAILED') and new.status <> old.status then
    raise exception 'a closed video session never reopens'
      using errcode = '23514';
  end if;
  if old.provider_key_index is not null
     and new.provider_key_index is distinct from old.provider_key_index then
    raise exception 'a video session keeps its provider key'
      using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
