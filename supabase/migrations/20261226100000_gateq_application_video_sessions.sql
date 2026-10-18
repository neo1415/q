-- GateQ video interview sessions (directive C3, lead decision 2026-10-15).
--
-- The applicant may meet Q by video for the SAME canonical interview: every
-- line the provider's interviewer speaks comes from the existing GateQ
-- conversation service through a per-session bridge, so turns, facts and
-- lineage land in gateq.application_turns/application_facts exactly as a
-- typed turn would. This table only holds the provider session:
--
--   * limits: ends_at is fixed at creation and never moves; the per-
--     application allowance and the concurrency cap are configuration,
--     enforced under the application row lock and a global advisory lock;
--   * the bridge: the bearer the provider presents is stored only as its
--     SHA-256; the guest credential the bridge acts with is stored sealed
--     (application-level encryption), never in clear;
--   * cleanup: the provider conversation id, so ending and the sweep end
--     the same room.
--
-- Server-only, like every gateq table: RLS on, no policy, no browser grant.

create table gateq.application_video_sessions (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  application_id            uuid not null,
  status                    text not null default 'STARTING'
                              check (status in ('STARTING', 'LIVE', 'ENDED')),
  ended_reason              text check (ended_reason in (
                              'APPLICANT_ENDED', 'CONTINUED_BY_TYPING',
                              'TIME_LIMIT', 'PROVIDER_FAILED', 'SWEPT')),
  provider                  text not null default 'TAVUS' check (provider in ('TAVUS')),
  provider_conversation_id  text check (
                              provider_conversation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  join_url_sealed           text check (length(join_url_sealed) <= 4096),
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

create index application_video_sessions_by_application_idx
  on gateq.application_video_sessions (application_id, created_at desc);
create index application_video_sessions_live_idx
  on gateq.application_video_sessions (ends_at) where status <> 'ENDED';

-- The clock and the identity of a session never move once written; an
-- ended session never reopens.
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
    or new.ends_at is distinct from old.ends_at
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
create trigger application_video_session_immutable
  before update on gateq.application_video_sessions
  for each row execute function gateq.protect_application_video_session();

alter table gateq.application_video_sessions enable row level security;
revoke all on gateq.application_video_sessions from public, anon, authenticated;
