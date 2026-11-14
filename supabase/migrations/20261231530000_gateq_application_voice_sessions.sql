-- GateQ voice-only interview sessions (directive 2026-11-14 item 4, slice 1).
--
-- The applicant may talk with Q instead of typing, in the SAME canonical
-- interview: every line the speech provider hears comes back through a
-- per-line bridge that calls the existing GateQ conversation service with
-- channel 'voice', so turns, facts and lineage land in
-- gateq.application_turns / application_facts exactly as a typed turn's.
-- This table only holds the session:
--
--   * limits: ends_at is fixed at creation and never moves; the per-
--     application allowance (a PROVIDER_FAILED open never counts: no audio
--     flowed) and the concurrency cap are enforced under the application
--     row lock and a global advisory lock;
--   * the bridge: only the SHA-256 of the current line's bearer is stored;
--     a reconnect replaces it (same session, same clock). The guest
--     credential the bridge acts with is sealed (application encryption);
--   * usage: created_at to ended_at is the seconds the line was open.
--
-- Server-only, like every gateq table: RLS on, no policy, no browser grant.

create table gateq.application_voice_sessions (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  application_id            uuid not null,
  status                    text not null default 'LIVE'
                              check (status in ('LIVE', 'ENDED')),
  ended_reason              text check (ended_reason in (
                              'APPLICANT_ENDED', 'CONTINUED_BY_TYPING',
                              'TIME_LIMIT', 'PROVIDER_FAILED', 'SWEPT')),
  provider                  text not null default 'DEEPGRAM' check (provider in ('DEEPGRAM')),
  bridge_token_hash         text not null unique check (bridge_token_hash ~ '^[0-9a-f]{64}$'),
  guest_credential_sealed   text not null check (length(guest_credential_sealed) <= 4096),
  max_seconds               integer not null check (max_seconds between 1 and 3600),
  created_at                timestamptz not null default now(),
  ends_at                   timestamptz not null,
  ended_at                  timestamptz,
  foreign key (application_id, tenant_id)
    references gateq.applications (id, tenant_id) on delete restrict,
  check (ends_at > created_at and ends_at <= created_at + make_interval(secs => max_seconds)),
  check ((status = 'ENDED') = (ended_at is not null and ended_reason is not null))
);

create index application_voice_sessions_by_application_idx
  on gateq.application_voice_sessions (application_id, tenant_id, created_at desc);
create index application_voice_sessions_live_idx
  on gateq.application_voice_sessions (ends_at) where status = 'LIVE';

-- The clock and the identity of a session never move once written; an
-- ended session never reopens and its line bearer is never replaced.
create or replace function gateq.protect_application_voice_session()
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
    or new.ends_at is distinct from old.ends_at
    or new.max_seconds is distinct from old.max_seconds
    or new.guest_credential_sealed is distinct from old.guest_credential_sealed
    or (old.status = 'ENDED' and (new.status is distinct from 'ENDED'
        or new.bridge_token_hash is distinct from old.bridge_token_hash)) then
    raise exception 'a voice session''s identity, clock and end are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function gateq.protect_application_voice_session() from public, anon, authenticated;
create trigger application_voice_session_immutable
  before update on gateq.application_voice_sessions
  for each row execute function gateq.protect_application_voice_session();

alter table gateq.application_voice_sessions enable row level security;
revoke all on gateq.application_voice_sessions from public, anon, authenticated;
