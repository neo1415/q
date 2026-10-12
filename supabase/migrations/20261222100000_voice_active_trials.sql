-- Existing GPT-Live, owner-private cumulative active-speech trials.
-- Explicit operators insert only authorized existing users, after release gates.
-- No default rows, account creation, monthly reset, billing changes or public access.
create table q_runtime.voice_active_trials (
  user_id uuid primary key references identity.user_profiles(id) on delete cascade,
  allowance_ms integer not null default 300000 check (allowance_ms = 300000),
  consumed_ms integer not null default 0 check (consumed_ms between 0 and allowance_ms),
  -- Reserve the whole remaining allowance: one paid trial line per person,
  -- across tabs/instances. No time-based unlocking while an old provider is live.
  reserved_session_id uuid,
  session_active_ms integer not null default 0 check (session_active_ms >= 0),
  heartbeat_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((reserved_session_id is null and heartbeat_at is null and session_active_ms = 0)
    or (reserved_session_id is not null and heartbeat_at is not null))
);
alter table q_runtime.voice_active_trials enable row level security;
revoke all on q_runtime.voice_active_trials from public, anon, authenticated;
grant select, insert, update on q_runtime.voice_active_trials to postgres, service_role;
comment on table q_runtime.voice_active_trials is
  'Owner-private GPT-Live trial allowance in active speech milliseconds. Browser-measured speech is not provider-signed usage. Silence does not consume allowance; provider billed cost remains on ai_ops.model_usage. Reservations release only after confirmed provider termination.';
