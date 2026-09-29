-- Q in a meeting (founder direction 2026-09-29): the organiser asks Q to
-- join a booked call; a meeting bot joins under Q's name, the call's
-- captions become a transcript, and Q files notes, flags and follow-ups
-- for the organiser afterwards.
--
-- One row per meeting, owned by the organiser who asked. The transcript
-- itself is not kept: the notes are what Q wrote from it, a generated
-- artifact (not evidence, not truth, not a disclosure), visible only to
-- the organiser. The provider's bot id is an opaque reference, never an
-- authority: access is decided here, by the row's owner.

create table communication.meeting_assistants (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id         uuid not null references communication.meetings (id) on delete restrict,
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  user_id            uuid not null references identity.user_profiles (id) on delete restrict,
  provider           text not null check (provider in ('recall')),
  provider_bot_id    text check (provider_bot_id is null or provider_bot_id ~ '^[A-Za-z0-9-]{8,80}$'),
  status             text not null default 'REQUESTED'
                       check (status in ('REQUESTED', 'SCHEDULED', 'IN_CALL', 'COMPOSING', 'DONE', 'FAILED', 'CANCELLED')),
  failure            text check (failure is null or length(failure) <= 200),
  summary            text check (summary is null or length(summary) between 1 and 4000),
  flags              jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  follow_ups         jsonb not null default '[]'::jsonb check (jsonb_typeof(follow_ups) = 'array'),
  composer_version   text check (composer_version is null or composer_version ~ '^[a-z0-9._-]{1,40}$'),
  idempotency_key    text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp(),
  unique (meeting_id),
  unique (user_id, idempotency_key)
);

comment on table communication.meeting_assistants is
  'Q attending a meeting at its organiser''s request: the bot reference, its state, and the notes Q wrote afterwards. Owner-only; the transcript is not stored.';

create index meeting_assistants_open_idx
  on communication.meeting_assistants (status, updated_at)
  where status in ('REQUESTED', 'SCHEDULED', 'IN_CALL', 'COMPOSING');

alter table communication.meeting_assistants enable row level security;

create policy meeting_assistants_select_own
  on communication.meeting_assistants for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on communication.meeting_assistants to authenticated;

-- The organiser is told when Q's notes are ready.
alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY', 'MEETING_NOTES_READY'));
