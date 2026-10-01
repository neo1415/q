-- MEET-HOST (founder direction 2026-10-01): who was in a call Q hosted.
-- Additive. One row per thing Q observed about a participant -- arrived,
-- introduced themselves, left, removed Q -- appended, never changed. A
-- Capital Q identity is set only when the call participant matched an
-- invited person; a guest's name, role and organisation come only from
-- their own introduction, and what they did not say stays null.

create table communication.meeting_roster_entries (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid not null references communication.meetings (id) on delete restrict,
  -- The organiser's tenant, as on communication.meeting_assistants.
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  -- The call's own participant id (Recall), as text.
  participant_key  text not null check (length(participant_key) between 1 and 120),
  call_name        text not null check (length(call_name) between 1 and 200),
  kind             text not null check (kind in ('ARRIVED', 'INTRODUCED', 'LEFT', 'REMOVED_Q')),
  source           text not null check (source in ('CAPITAL_Q_IDENTITY', 'CALL_NAME', 'SELF_INTRODUCTION')),
  user_id          uuid references identity.user_profiles (id) on delete restrict,
  side             text check (side in ('FOUNDER', 'INVESTOR')),
  name             text check (length(name) between 1 and 200),
  role             text check (length(role) between 1 and 200),
  organisation     text check (length(organisation) between 1 and 200),
  observed_at      timestamptz not null default clock_timestamp(),
  -- An identity is claimed only by a match to an invited person.
  check ((source = 'CAPITAL_Q_IDENTITY') = (user_id is not null)),
  check (source <> 'SELF_INTRODUCTION' or kind = 'INTRODUCED')
);

comment on table communication.meeting_roster_entries is
  'Who was in a call Q hosted (ADR 0027 §3): arrivals, self-introductions, departures and removals of Q, append-only. Guests are recorded only from what they said about themselves; unknown stays null. Both sides of the call may read it.';

create index meeting_roster_entries_meeting_idx
  on communication.meeting_roster_entries (meeting_id, observed_at);

create function private.communication_meeting_roster_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'communication.meeting_roster_entries is append-only'
    using errcode = '55000';
end
$$;

create trigger meeting_roster_entries_append_only
  before update or delete on communication.meeting_roster_entries
  for each row execute function private.communication_meeting_roster_append_only();

alter table communication.meeting_roster_entries enable row level security;

-- Everyone invited to the call reads who was in it, as they read its record.
create policy meeting_roster_entries_select_participant
  on communication.meeting_roster_entries for select to authenticated
  using (
    exists (
      select 1 from communication.meeting_participants p
       where p.meeting_id = meeting_roster_entries.meeting_id
         and p.user_id = (select private.current_app_user_id())
         and (select private.is_tenant_member(p.participant_tenant_id))
    )
  );

-- Read only from the browser; the server alone appends.
revoke all on communication.meeting_roster_entries from anon, authenticated;
grant select on communication.meeting_roster_entries to authenticated;

-- What Q noted in or about a call it hosted, append-only: an action someone
-- asked for in the call (a PROPOSAL, for the organiser to approve after the
-- call -- Q never does it in the call), and how the call turned out when
-- people did not come (NO_SHOW; ONE_SIDED with whether those present want
-- a new time, RESCHEDULE_WANTED, or said NEVER_MIND).
create table communication.meeting_host_notes (
  id                    uuid primary key default gen_random_uuid(),
  meeting_id            uuid not null references communication.meetings (id) on delete restrict,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  kind                  text not null check (kind in ('PROPOSAL', 'NO_SHOW', 'ONE_SIDED', 'RESCHEDULE_WANTED', 'NEVER_MIND')),
  body                  text check (length(body) between 1 and 500),
  requested_by_name     text check (length(requested_by_name) between 1 and 200),
  requested_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  absent_side           text check (absent_side in ('FOUNDER', 'INVESTOR')),
  created_at            timestamptz not null default clock_timestamp(),
  check (kind <> 'PROPOSAL' or body is not null),
  check ((kind = 'ONE_SIDED') = (absent_side is not null))
);

comment on table communication.meeting_host_notes is
  'What Q noted in or about a call it hosted (MEET-HOST): proposals for the organiser to approve after the call (never acted on in the call), and no-show outcomes. Append-only.';

create index meeting_host_notes_meeting_idx
  on communication.meeting_host_notes (meeting_id, created_at);

create function private.communication_meeting_host_notes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'communication.meeting_host_notes is append-only'
    using errcode = '55000';
end
$$;

create trigger meeting_host_notes_append_only
  before update or delete on communication.meeting_host_notes
  for each row execute function private.communication_meeting_host_notes_append_only();

alter table communication.meeting_host_notes enable row level security;

-- Outcomes are both sides'; a proposal is the organiser's to approve.
create policy meeting_host_notes_select_participant
  on communication.meeting_host_notes for select to authenticated
  using (
    exists (
      select 1 from communication.meeting_participants p
        join communication.meetings m on m.id = p.meeting_id
       where p.meeting_id = meeting_host_notes.meeting_id
         and p.user_id = (select private.current_app_user_id())
         and (select private.is_tenant_member(p.participant_tenant_id))
         and (meeting_host_notes.kind <> 'PROPOSAL' or m.organiser_user_id = p.user_id)
    )
  );

revoke all on communication.meeting_host_notes from anon, authenticated;
grant select on communication.meeting_host_notes to authenticated;
