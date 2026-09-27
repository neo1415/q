-- BIZ-008 · Meetings + reminders v1 (R11, R14, R34).
--
-- communication.meetings              a call on ONE canonical relationship,
--                                     organised by one person, with a
--                                     Google Calendar event + Meet link
-- communication.meeting_participants  who was invited: the organiser and the
--                                     counterparty's own people only
-- communication.meeting_briefs        the prep brief composed for the
--                                     organiser at T-24h (an artifact)
-- communication.reminders             a person's own reminder, optionally
--                                     about one relationship
-- communication.notifications         a person's in-app notices (Needs you)
--
-- Not a CRM and not a parallel relationship: the relationship row stays the
-- only truth and its history is network.relationship_events
-- (meeting_scheduled / meeting_rescheduled / meeting_cancelled, activity
-- only). No provider credential lives here; the Google access token is
-- minted from the sealed refresh token in integrations.google_accounts.
--
-- Access: every mutation is server-side (the privileged server role), after
-- the application has authorised the person (party check through Network,
-- approval through the Approval Engine). A signed-in person may read:
--   meetings      they organise or were invited to (own participant row)
--   participants  their own participant rows
--   briefs, reminders, notifications   their own
-- and only while an active member of the tenant the row names for them.
--
-- Additive only.

create schema if not exists communication;
revoke all on schema communication from public;
grant usage on schema communication to authenticated;

-- ---------------------------------------------------------------------------
-- communication.meetings
-- ---------------------------------------------------------------------------

create table communication.meetings (
  id                   uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company tenant, ADR 0003).
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  relationship_id      uuid not null,
  organiser_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  -- The organiser's own tenant (their side of the relationship).
  organiser_tenant_id  uuid not null references identity.tenants (id) on delete restrict,
  purpose              text not null check (length(btrim(purpose)) between 1 and 500),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  -- IANA zone the organiser works in; slots and the invite use it.
  time_zone            text not null check (time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' and length(time_zone) <= 64),
  status               text not null default 'SCHEDULING'
                         check (status in ('SCHEDULING', 'SCHEDULED', 'CANCELLED', 'FAILED')),
  -- Client-chosen Google event id (base32hex), so a retried insert is the
  -- same event, never a second one.
  google_event_id      text not null check (google_event_id ~ '^[a-v0-9]{5,255}$'),
  meet_link            text check (meet_link is null or meet_link ~ '^https://meet\.google\.com/[a-z0-9-]{3,64}$'),
  q_action_id          uuid,
  idempotency_key      text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  prep_brief_at        timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default clock_timestamp(),
  updated_at           timestamptz not null default clock_timestamp(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '8 hours'),
  check ((status = 'CANCELLED') = (cancelled_at is not null)),
  unique (id, tenant_id),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table communication.meetings is
  'A call on one canonical relationship (BIZ-008): Google Calendar event with a Meet link, created only after the organiser approved the exact proposal. Relationship history is network.relationship_events (meeting_*); this row is not a CRM record.';

create unique index meetings_one_per_q_action
  on communication.meetings (q_action_id) where q_action_id is not null;
create unique index meetings_idempotency_key
  on communication.meetings (idempotency_key);
create unique index meetings_google_event
  on communication.meetings (google_event_id);
create index meetings_relationship_starts_idx
  on communication.meetings (relationship_id, starts_at);
create index meetings_organiser_starts_idx
  on communication.meetings (organiser_user_id, starts_at);
create index meetings_prep_due_idx
  on communication.meetings (starts_at) where status = 'SCHEDULED' and prep_brief_at is null;

create trigger set_updated_at
  before update on communication.meetings
  for each row execute function private.set_updated_at();

alter table communication.meetings enable row level security;

-- ---------------------------------------------------------------------------
-- communication.meeting_participants
-- ---------------------------------------------------------------------------

create table communication.meeting_participants (
  id                     uuid primary key default gen_random_uuid(),
  meeting_id             uuid not null references communication.meetings (id) on delete restrict,
  -- The participant's own tenant (their organisation's).
  participant_tenant_id  uuid not null references identity.tenants (id) on delete restrict,
  user_id                uuid not null references identity.user_profiles (id) on delete restrict,
  role                   text not null check (role in ('ORGANISER', 'ATTENDEE')),
  display_name           text not null check (length(display_name) between 1 and 200),
  email                  text not null check (length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  created_at             timestamptz not null default clock_timestamp(),
  unique (meeting_id, user_id)
);

comment on table communication.meeting_participants is
  'Who a meeting invited (BIZ-008): the organiser and people of the counterparty organisation on the same relationship. Nobody outside the relationship is ever a participant.';

create index meeting_participants_user_idx
  on communication.meeting_participants (user_id, meeting_id);

alter table communication.meeting_participants enable row level security;

create policy meeting_participants_select_own
  on communication.meeting_participants for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(participant_tenant_id))
  );

grant select on communication.meeting_participants to authenticated;

-- Meetings: the reader's own participant row (subject to its own policy)
-- is the proof. No SECURITY DEFINER helper is needed.
create policy meetings_select_participant
  on communication.meetings for select to authenticated
  using (
    exists (
      select 1 from communication.meeting_participants p
       where p.meeting_id = meetings.id
         and p.user_id = (select private.current_app_user_id())
         and (select private.is_tenant_member(p.participant_tenant_id))
    )
  );

grant select (id, tenant_id, relationship_id, organiser_user_id, purpose, starts_at, ends_at,
              time_zone, status, meet_link, cancelled_at, created_at, updated_at)
  on communication.meetings to authenticated;

-- ---------------------------------------------------------------------------
-- communication.meeting_briefs
-- ---------------------------------------------------------------------------

create table communication.meeting_briefs (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references communication.meetings (id) on delete restrict,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  composer_version  text not null check (composer_version ~ '^[a-z0-9._-]{1,40}$'),
  body              text not null check (length(body) between 1 and 8000),
  created_at        timestamptz not null default clock_timestamp(),
  unique (meeting_id, user_id)
);

comment on table communication.meeting_briefs is
  'The prep brief for a meeting (BIZ-008), composed deterministically for the organiser 24 hours before from what they may already see. A generated artifact: not evidence, not truth, not a disclosure.';

alter table communication.meeting_briefs enable row level security;

create policy meeting_briefs_select_own
  on communication.meeting_briefs for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on communication.meeting_briefs to authenticated;

-- ---------------------------------------------------------------------------
-- communication.reminders
-- ---------------------------------------------------------------------------

create table communication.reminders (
  id                uuid primary key default gen_random_uuid(),
  -- The owner's tenant.
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  owner_user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  relationship_id   uuid references network.relationships (id) on delete restrict,
  meeting_id        uuid references communication.meetings (id) on delete restrict,
  title             text not null check (length(btrim(title)) between 1 and 200),
  note              text check (note is null or length(note) <= 1000),
  due_at            timestamptz not null,
  -- IN_APP: Needs you only. EMAIL: Needs you and an email.
  channel           text not null default 'IN_APP' check (channel in ('IN_APP', 'EMAIL')),
  status            text not null default 'PENDING'
                      check (status in ('PENDING', 'DELIVERED', 'DISMISSED', 'CANCELLED')),
  source            text not null check (source in ('PERSON', 'MEETING')),
  q_action_id       uuid,
  idempotency_key   text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  delivered_at      timestamptz,
  email_sent_at     timestamptz,
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  check ((source = 'MEETING') = (meeting_id is not null)),
  check (status <> 'DELIVERED' or delivered_at is not null)
);

comment on table communication.reminders is
  'A person''s own reminder (BIZ-008), delivered in-app (Needs you) and, when asked, by email at its due time. A meeting''s own T-15 reminder has source MEETING.';

create unique index reminders_one_per_q_action
  on communication.reminders (q_action_id) where q_action_id is not null;
create unique index reminders_owner_idempotency
  on communication.reminders (owner_user_id, idempotency_key);
create unique index reminders_one_per_meeting
  on communication.reminders (meeting_id) where meeting_id is not null;
create index reminders_due_idx
  on communication.reminders (due_at) where status = 'PENDING';
create index reminders_owner_idx
  on communication.reminders (owner_user_id, due_at);

create trigger set_updated_at
  before update on communication.reminders
  for each row execute function private.set_updated_at();

alter table communication.reminders enable row level security;

create policy reminders_select_own
  on communication.reminders for select to authenticated
  using (
    owner_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on communication.reminders to authenticated;

-- ---------------------------------------------------------------------------
-- communication.notifications
-- ---------------------------------------------------------------------------

create table communication.notifications (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.tenants (id) on delete restrict,
  user_id       uuid not null references identity.user_profiles (id) on delete restrict,
  kind          text not null check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY')),
  title         text not null check (length(title) between 1 and 200),
  body          text check (body is null or length(body) <= 1000),
  -- A same-origin app path only; never an external URL.
  link_path     text check (link_path is null or link_path ~ '^/[A-Za-z0-9/_-]{0,200}$'),
  reminder_id   uuid references communication.reminders (id) on delete restrict,
  meeting_id    uuid references communication.meetings (id) on delete restrict,
  -- One notice per happening, however many times a worker retries.
  dedupe_key    text not null check (length(dedupe_key) between 8 and 200),
  read_at       timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  unique (user_id, dedupe_key)
);

comment on table communication.notifications is
  'A person''s in-app notices (BIZ-008): due reminders, meetings scheduled or cancelled, a prep brief ready. Not analytics, not audit.';

create index notifications_user_created_idx
  on communication.notifications (user_id, created_at desc);

alter table communication.notifications enable row level security;

create policy notifications_select_own
  on communication.notifications for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on communication.notifications to authenticated;
