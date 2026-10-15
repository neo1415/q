-- The founder's video clock starts when the room is ready (lead decision
-- 2026-10-15, after a live rehearsal whose provider took 88 s to allocate
-- and left the founder 1:17 of their 3:00 when the room opened).
--
-- Both video session tables fixed ends_at at row creation. Now a session's
-- end may move exactly once, when it goes live: live_at is the moment the
-- provider room was ready, and ends_at becomes live_at + the session cap.
-- live_at must fall inside the original window (a start that takes longer
-- is swept as before), so a session can never run longer than its cap
-- after it is ready, nor start later than its original end.
--
-- Billing is unchanged: the usage ledger still counts from allocation
-- (created_at) and at most the cap, which is never less than the provider
-- bills, because the provider's own maximum call duration is the cap.

alter table q_runtime.rehearsal_video_sessions add column live_at timestamptz;
alter table q_runtime.rehearsal_video_sessions
  drop constraint rehearsal_video_absolute_cap,
  drop constraint rehearsal_video_sessions_check;
alter table q_runtime.rehearsal_video_sessions
  add constraint rehearsal_video_sessions_clock check (
    ends_at > created_at
    and (live_at is null or (live_at >= created_at and live_at <= created_at + interval '180 seconds'))
    and ends_at <= coalesce(live_at, created_at) + interval '180 seconds');

create or replace function q_runtime.rehearsal_video_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one move a clock may make: on going live, to live_at + 180 s.
  if new.ends_at <> old.ends_at
     and not (old.status = 'STARTING' and new.status = 'LIVE'
              and old.live_at is null and new.live_at is not null
              and new.ends_at = new.live_at + interval '180 seconds') then
    raise exception 'a video session keeps its owner, rehearsal, token and cap'
      using errcode = '23514';
  end if;
  if old.live_at is not null and new.live_at is distinct from old.live_at then
    raise exception 'a video session''s ready time never moves'
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

alter table gateq.application_video_sessions add column live_at timestamptz;
alter table gateq.application_video_sessions drop constraint application_video_sessions_check;
alter table gateq.application_video_sessions
  add constraint application_video_sessions_clock check (
    ends_at > created_at
    and (live_at is null or (live_at >= created_at
                             and live_at <= created_at + make_interval(secs => max_seconds)))
    and ends_at <= coalesce(live_at, created_at) + make_interval(secs => max_seconds));

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
        -- The one move a clock may make: on going live, to live_at + cap.
        and not (old.status = 'STARTING' and new.status = 'LIVE'
                 and old.live_at is null and new.live_at is not null
                 and new.ends_at = new.live_at + make_interval(secs => new.max_seconds)))
    or (old.live_at is not null and new.live_at is distinct from old.live_at)
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
