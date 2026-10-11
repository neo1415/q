-- C (2026-10-09, live bug): a meeting time is a proposal the investor (or an
-- authorised party) accepts, never a booking Q or the founder makes alone.
--
--   PROPOSED -> INVESTOR_REVIEW -> CONFIRMED | DECLINED | COUNTERPROPOSED
--   COUNTERPROPOSED -> CONFIRMED (founder accepts) | DECLINED | PROPOSED (founder re-proposes)
--
-- communication.meeting_time_proposals       the current state of one negotiation
-- communication.meeting_time_proposal_events append-only history; every acting
--                                            event carries an idempotency key
--
-- Server-only: the application authorises the caller (party check, side
-- derived from membership, never supplied by the client) before it writes.
-- Existing genuinely confirmed meetings (status SCHEDULED) are backfilled as
-- CONFIRMED with a LEGACY_CONFIRMED event; nothing about them changes.
-- Forward-only and additive.

create table communication.meeting_time_proposals (
  id                       uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company tenant, ADR 0003).
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,
  relationship_id          uuid not null,
  purpose                  text not null check (length(btrim(purpose)) between 1 and 500),
  proposed_by_user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  state                    text not null default 'PROPOSED'
                             check (state in ('PROPOSED', 'INVESTOR_REVIEW', 'CONFIRMED', 'DECLINED', 'COUNTERPROPOSED')),
  -- The founder's options, and the investor's counter options when they counter:
  -- [{ "startsAt": iso, "endsAt": iso, "timeZone": iana }]
  options                  jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 5),
  counter_options          jsonb check (counter_options is null
                             or (jsonb_typeof(counter_options) = 'array' and jsonb_array_length(counter_options) between 1 and 5)),
  -- Which list the accepted option came from, and its index.
  accepted_from            text check (accepted_from in ('OPTIONS', 'COUNTER_OPTIONS')),
  accepted_option          integer check (accepted_option between 0 and 4),
  accepted_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  accepted_at              timestamptz,
  -- A move of a meeting that already exists: it stays valid until this
  -- proposal is CONFIRMED.
  reschedule_of_meeting_id uuid references communication.meetings (id) on delete restrict,
  -- The meeting booked after acceptance (null until the booking succeeds).
  meeting_id               uuid references communication.meetings (id) on delete restrict,
  revision                 integer not null default 1 check (revision between 1 and 20),
  idempotency_key          text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at               timestamptz not null default clock_timestamp(),
  updated_at               timestamptz not null default clock_timestamp(),
  -- Nothing is CONFIRMED without a recorded, attributed acceptance.
  check ((state = 'CONFIRMED') = (accepted_at is not null)),
  check ((state = 'CONFIRMED') = (accepted_option is not null)),
  check ((state = 'CONFIRMED') = (accepted_by_user_id is not null)),
  check ((state = 'CONFIRMED') = (accepted_from is not null)),
  check (meeting_id is null or state = 'CONFIRMED'),
  check (state <> 'COUNTERPROPOSED' or counter_options is not null),
  unique (id, tenant_id),
  unique (relationship_id, idempotency_key),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table communication.meeting_time_proposals is
  'A meeting time under negotiation between the two sides of one canonical relationship. Binding only when the investor (or an authorised party) accepts: state CONFIRMED carries who and when. Not a CRM record, not a booking: the booking is communication.meetings.';

create unique index meeting_time_proposals_meeting_idx
  on communication.meeting_time_proposals (meeting_id) where meeting_id is not null;
create index meeting_time_proposals_relationship_idx
  on communication.meeting_time_proposals (relationship_id, created_at desc);

create table communication.meeting_time_proposal_events (
  id               uuid primary key default gen_random_uuid(),
  proposal_id      uuid not null references communication.meeting_time_proposals (id) on delete restrict,
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  event_type       text not null check (event_type in (
                     'PROPOSED', 'SENT_FOR_REVIEW', 'ACCEPTED', 'DECLINED',
                     'COUNTERPROPOSED', 'COUNTER_ACCEPTED', 'COUNTER_DECLINED',
                     'REPROPOSED', 'LEGACY_CONFIRMED')),
  from_state       text check (from_state in ('PROPOSED', 'INVESTOR_REVIEW', 'CONFIRMED', 'DECLINED', 'COUNTERPROPOSED')),
  to_state         text not null check (to_state in ('PROPOSED', 'INVESTOR_REVIEW', 'CONFIRMED', 'DECLINED', 'COUNTERPROPOSED')),
  -- Derived from the actor's membership by the server; null: the system.
  actor_user_id    uuid references identity.user_profiles (id) on delete restrict,
  actor_side       text check (actor_side in ('FOUNDER', 'INVESTOR')),
  option_index     integer check (option_index between 0 and 4),
  idempotency_key  text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at       timestamptz not null default clock_timestamp(),
  unique (proposal_id, idempotency_key)
);

comment on table communication.meeting_time_proposal_events is
  'Append-only history of a meeting time negotiation. Corrections are new events. Not audit, not outbox, not analytics.';

create index meeting_time_proposal_events_proposal_idx
  on communication.meeting_time_proposal_events (proposal_id, created_at);

create function private.meeting_time_proposal_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'meeting time proposal history is append-only; record a new event instead'
    using errcode = '55000';
end
$$;

revoke all on function private.meeting_time_proposal_events_append_only() from public, anon, authenticated;

create trigger meeting_time_proposal_events_append_only
  before update or delete on communication.meeting_time_proposal_events
  for each row execute function private.meeting_time_proposal_events_append_only();

alter table communication.meeting_time_proposals enable row level security;
alter table communication.meeting_time_proposal_events enable row level security;

-- No policy and no grant for authenticated or anon: server-only. Reads go
-- through the API, which checks the caller is a party to the relationship.
revoke all on communication.meeting_time_proposals from anon, authenticated;
revoke all on communication.meeting_time_proposal_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: every genuinely confirmed meeting is a CONFIRMED proposal
-- ---------------------------------------------------------------------------

insert into communication.meeting_time_proposals
  (id, tenant_id, relationship_id, purpose, proposed_by_user_id, state, options,
   accepted_from, accepted_option, accepted_by_user_id, accepted_at,
   meeting_id, idempotency_key, created_at, updated_at)
select gen_random_uuid(), m.tenant_id, m.relationship_id, m.purpose, m.organiser_user_id, 'CONFIRMED',
       jsonb_build_array(jsonb_build_object(
         'startsAt', to_char(m.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'endsAt',   to_char(m.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'timeZone', m.time_zone)),
       'OPTIONS', 0, m.organiser_user_id, m.created_at,
       m.id, 'legacy-meeting:' || m.id::text, m.created_at, m.created_at
  from communication.meetings m
 where m.status = 'SCHEDULED'
   and m.origin = 'BOOKED';

insert into communication.meeting_time_proposal_events
  (proposal_id, tenant_id, event_type, from_state, to_state, actor_user_id, idempotency_key, created_at)
select p.id, p.tenant_id, 'LEGACY_CONFIRMED', null, 'CONFIRMED', null,
       'legacy-confirmed:' || p.meeting_id::text, p.created_at
  from communication.meeting_time_proposals p
 where p.idempotency_key like 'legacy-meeting:%';
