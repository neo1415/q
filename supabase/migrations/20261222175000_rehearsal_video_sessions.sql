-- Video rehearsals (ADR 0066, owner directive 2026-10-12): a founder meets
-- the rehearsal's counterpart as a stock AI interviewer (a Tavus face and
-- voice) whose every line comes from the existing rehearsal service. This
-- table holds one live provider session per rehearsal:
--
--   * idempotency and the hard cap: one row per rehearsal, ever, with its
--     end time fixed at creation (created_at + 180 s), so a retry, a
--     refresh or a reconnect returns the same session and never restarts
--     the clock;
--   * the bridge: the per-session bearer the provider presents on each
--     line is stored only as its SHA-256 (never the secret itself);
--   * cleanup: which configured provider key (its INDEX in server
--     configuration, never the key) and which provider objects were
--     created, so ending uses the same account;
--   * metering: the seconds the session lasted.
--
-- The acting person (tenant, user, organisation context) is kept so the
-- bridge, which the provider calls without the founder's cookie, speaks to
-- the rehearsal service as that founder and nobody wider.
--
-- Server-only, like every q_runtime voice table: RLS on with no policies,
-- no browser grants. The Q API reads and writes it with an explicit tenant
-- and user in every statement (the bridge reads by token hash).

create table q_runtime.rehearsal_video_sessions (
  id                        uuid primary key,
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id           uuid,
  membership_id             uuid,
  rehearsal_id              uuid not null unique
                              references q_runtime.rehearsals (id) on delete restrict,
  interviewer_id            text not null check (interviewer_id ~ '^[a-z][a-z0-9-]{1,47}$'),
  provider                  text not null default 'TAVUS' check (provider in ('TAVUS')),
  -- Index into the server's configured key list (CQ_TAVUS_API_KEYS).
  provider_key_index        smallint check (provider_key_index between 0 and 31),
  provider_pal_id           text check (
                              provider_pal_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  provider_conversation_id  text check (
                              provider_conversation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  -- SHA-256 (hex) of the single-session bridge bearer.
  bridge_token_hash         text not null unique check (bridge_token_hash ~ '^[0-9a-f]{64}$'),
  status                    text not null default 'STARTING'
                              check (status in ('STARTING', 'LIVE', 'ENDED', 'FAILED')),
  ended_reason              text check (ended_reason is null or ended_reason in (
                              'FOUNDER_ENDED', 'TIME_LIMIT', 'CONTINUED_BY_VOICE',
                              'PROVIDER_ENDED', 'PROVIDER_UNAVAILABLE')),
  created_at                timestamptz not null default clock_timestamp(),
  -- Fixed at creation and never moved: the three-minute cap.
  ends_at                   timestamptz not null,
  ended_at                  timestamptz,
  seconds                   integer check (seconds is null or seconds between 0 and 86400),
  updated_at                timestamptz not null default clock_timestamp(),

  check (ends_at > created_at and ends_at <= created_at + interval '181 seconds'),
  check ((status in ('ENDED', 'FAILED')) = (ended_at is not null)),
  check ((status in ('ENDED', 'FAILED')) = (ended_reason is not null))
);

comment on table q_runtime.rehearsal_video_sessions is
  'Video rehearsal provider sessions (ADR 0066): one per rehearsal, cap fixed at creation, bridge bearer stored hashed, provider key recorded by index only. Server-only.';

-- The sweep that ends sessions past their cap.
create index rehearsal_video_sessions_open_idx
  on q_runtime.rehearsal_video_sessions (ends_at)
  where status in ('STARTING', 'LIVE');

create index rehearsal_video_sessions_owner_idx
  on q_runtime.rehearsal_video_sessions (tenant_id, user_id, created_at desc);

-- The cap and the owner never move; a closed session never reopens.
create function q_runtime.rehearsal_video_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ends_at <> old.ends_at
     or new.created_at <> old.created_at
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

create trigger rehearsal_video_sessions_guard
  before update on q_runtime.rehearsal_video_sessions
  for each row execute function q_runtime.rehearsal_video_sessions_guard();

alter table q_runtime.rehearsal_video_sessions enable row level security;

-- No policies and no client grants: the Q API is the boundary. No delete:
-- a session's record (and its metered seconds) is never removed.
revoke all on q_runtime.rehearsal_video_sessions from public, anon, authenticated;
grant select, insert, update on q_runtime.rehearsal_video_sessions to postgres, service_role;
revoke all on function q_runtime.rehearsal_video_sessions_guard() from public, anon, authenticated;
