-- GPT-Live trial (owner directive 2026-10-12): named people may use the
-- live voice for a cumulative allowance of ACTIVE SPEECH (their words plus
-- Q's; idle silence excluded). The grant itself is server configuration
-- (CQ_VOICE_LIVE_TRIAL on q-api); this table holds what has been used, so
-- the allowance survives reconnects, refreshes, other devices and restarts.
--
-- One row per provider session (a GPT-Live session the Q API created):
-- the Q API measures that session's speech from the provider's own events
-- and raises the row as it goes. A person's use is the sum of their rows.
-- Per-session rows mean two instances (two devices) never overwrite each
-- other's count, and a row only ever grows (trigger below): usage is never
-- silently lowered.
--
-- Owner-private and server-only, like every q_runtime voice table: RLS on
-- with no policies, no browser grants. The Q API reads and writes it only
-- as the person on the line (explicit tenant and user in every statement).

create table q_runtime.voice_live_trial_usage (
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  user_id              uuid not null references identity.user_profiles (id) on delete restrict,
  -- The provider's opaque session id: one row per GPT-Live session.
  provider_session_id  text not null check (
                         provider_session_id ~ '^[A-Za-z0-9_-]+$'
                         and length(provider_session_id) between 1 and 200),
  -- The Q API's voice session the line carried (an opaque id, for audit).
  voice_session_id     text not null check (
                         voice_session_id ~ '^[A-Za-z0-9._:-]+$'
                         and length(voice_session_id) between 1 and 128),
  -- Active speech measured on this session, seconds (bounded: one session
  -- can never be longer than a day).
  speech_seconds       numeric(9, 2) not null default 0 check (
                         speech_seconds >= 0 and speech_seconds <= 86400),
  created_at           timestamptz not null default clock_timestamp(),
  updated_at           timestamptz not null default clock_timestamp(),

  primary key (tenant_id, user_id, provider_session_id)
);

comment on table q_runtime.voice_live_trial_usage is
  'GPT-Live trial: active speech seconds used per provider session, owner-private and server-only. A person''s use is the sum of their rows; rows only grow. The grant is q-api configuration (CQ_VOICE_LIVE_TRIAL).';

-- A row only grows: a correction would be a new row, never a lower count.
create function q_runtime.voice_live_trial_usage_only_grows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.speech_seconds < old.speech_seconds then
    raise exception 'live trial usage never decreases'
      using errcode = '23514';
  end if;
  if new.tenant_id <> old.tenant_id
     or new.user_id <> old.user_id
     or new.provider_session_id <> old.provider_session_id
     or new.voice_session_id <> old.voice_session_id then
    raise exception 'live trial usage keeps its owner and session'
      using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger voice_live_trial_usage_only_grows
  before update on q_runtime.voice_live_trial_usage
  for each row execute function q_runtime.voice_live_trial_usage_only_grows();

alter table q_runtime.voice_live_trial_usage enable row level security;

-- No policies and no client grants: the Q API is the boundary. No delete:
-- spent allowance is not given back by removing a row.
revoke all on q_runtime.voice_live_trial_usage from public, anon, authenticated;
grant select, insert, update on q_runtime.voice_live_trial_usage to postgres, service_role;
revoke all on function q_runtime.voice_live_trial_usage_only_grows() from public, anon, authenticated;
