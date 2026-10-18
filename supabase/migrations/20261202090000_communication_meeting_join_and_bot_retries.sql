-- meet-47 (founder direction 2026-10-03; sorted after 20261201090000): Q must always be in the call, and
-- can be asked to join one on demand. Additive.
--
-- 1. communication.meetings.origin: BOOKED (Capital Q booked it, with a
--    Google Calendar event) or JOINED (a person on the relationship asked
--    Q to join a Google Meet link already running). A JOINED call has no
--    calendar event: its google_event_id is never sent to Google, and the
--    schedule service never moves or cancels a calendar event for it.
-- 2. communication.meeting_assistants: what the collector needs to keep Q
--    there -- how many times creating the bot was tried and when to try
--    again (a provider failure is retried with backoff, never final on the
--    first error), and the start and link the bot was booked for (a call
--    moved, or given a new link, after Q was booked gets a fresh bot).
--    Bots already booked are backfilled with their meeting's current start
--    and link, so only a change from now on rebooks them.

alter table communication.meetings
  add column origin text not null default 'BOOKED'
    check (origin in ('BOOKED', 'JOINED'));

comment on column communication.meetings.origin is
  'BOOKED: booked on Capital Q with a calendar event. JOINED: Q asked to join a running Google Meet; no calendar event exists.';

alter table communication.meeting_assistants
  add column attempts integer not null default 0
    check (attempts between 0 and 50),
  add column next_attempt_at timestamptz,
  add column booked_starts_at timestamptz,
  add column booked_meet_link text
    check (booked_meet_link is null or length(booked_meet_link) <= 300);

comment on column communication.meeting_assistants.attempts is
  'Times creating the meeting bot was tried (meet-47 retries with backoff).';
comment on column communication.meeting_assistants.next_attempt_at is
  'When a REQUESTED bot whose creation failed is tried again; null: not waiting.';
comment on column communication.meeting_assistants.booked_starts_at is
  'The meeting start the current bot was booked for; differs from the meeting after a reschedule.';

comment on column communication.meeting_assistants.booked_meet_link is
  'The Meet link the current bot was booked for; differs from the meeting after the link changed.';

update communication.meeting_assistants a
   set booked_starts_at = m.starts_at, booked_meet_link = m.meet_link
  from communication.meetings m
 where m.id = a.meeting_id
   and a.status in ('SCHEDULED', 'IN_CALL')
   and a.booked_starts_at is null;

create index meeting_assistants_retry_idx
  on communication.meeting_assistants (next_attempt_at)
  where status = 'REQUESTED';

create index meeting_assistants_bot_idx
  on communication.meeting_assistants (provider_bot_id)
  where provider_bot_id is not null;
