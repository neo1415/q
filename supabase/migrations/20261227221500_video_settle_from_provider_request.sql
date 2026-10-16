-- Video settlement bills what the provider can bill (lead 2026-10-16).
--
-- A fresh founder's GateQ session settled 93 s while Q was in the room for
-- 84 s: settlement counted from our own session row, which is written
-- before the opening line is composed and the provider is asked for a
-- room. Nothing can be billed before that request. From here a GateQ
-- session stamps provider_request_at just before the provider is asked,
-- and settlement runs from it (rounded up, so never under the provider),
-- still capped at the provider's own max_call_duration (cap + join grace).
-- Rehearsals already stamp provider_request_started_at; their settled
-- seconds are computed the same way by the service.
--
-- Sessions without the stamp (before this migration) settle as before.

alter table gateq.application_video_sessions
  add column provider_request_at timestamptz,
  add constraint application_video_sessions_provider_request
    check (provider_request_at is null or provider_request_at >= created_at);

-- Set once, only while the session is starting; never moved.
create or replace function gateq.protect_video_provider_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (old.provider_request_at is not null
      and new.provider_request_at is distinct from old.provider_request_at)
    or (old.provider_request_at is null and new.provider_request_at is not null
        and old.status <> 'STARTING') then
    raise exception 'a video session''s provider request time is set once, while starting'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.protect_video_provider_request() from public, anon, authenticated;
create trigger application_video_session_provider_request
  before update of provider_request_at on gateq.application_video_sessions
  for each row execute function gateq.protect_video_provider_request();

create or replace function gateq.video_session_settle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A failed start with a provider room (made, then not saved as live)
  -- may run until the provider's own cap: count it in full, never less.
  perform billing.settle_video_session(
    new.id,
    case when new.ended_reason = 'PROVIDER_FAILED' then least(new.max_seconds, 180) + 30
         else least(least(new.max_seconds, 180) + 30,
                    ceil(extract(epoch from (
                      new.ended_at - coalesce(new.provider_request_at, new.created_at))))::integer) end,
    new.ended_reason = 'PROVIDER_FAILED' and new.provider_conversation_id is null);
  return null;
end;
$$;
