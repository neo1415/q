-- AUTO (founder report 2026-10-02: "I can't see the meeting links in the
-- emails"): every participant of a booked call -- organiser and attendees
-- -- gets one Capital Q email with the time in their own zone, the Meet
-- link and a calendar file; and an updated one when the time or the link
-- changes. This ledger is what makes that once per meeting, person and
-- version, however often the worker runs. Server-only.

create table communication.meeting_emails (
  meeting_id   uuid not null references communication.meetings (id) on delete restrict,
  user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  -- A fingerprint of what the email said: time, link, title.
  version      text not null check (length(version) between 8 and 128),
  -- The iCalendar SEQUENCE: raised with each updated email.
  sequence     integer not null default 0 check (sequence between 0 and 1000),
  sent_at      timestamptz not null default clock_timestamp(),
  primary key (meeting_id, user_id)
);

comment on table communication.meeting_emails is
  'Which version of a booked call each participant was last emailed (AUTO). Server-only; a notice of delivery, never content.';

alter table communication.meeting_emails enable row level security;
-- No policies and no grants: no client reads or writes this.
revoke all on communication.meeting_emails from anon, authenticated;
