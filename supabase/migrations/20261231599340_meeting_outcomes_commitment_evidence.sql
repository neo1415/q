-- Q in meetings, slices S5, S6, S7 and S9 (owner, 2026-11-18;
-- docs/specs/meetings/2026-11-18-meetings-design.md R6-R9 and R11).
--
-- Additive only: new nullable columns, a widened check, and new tables.
-- No existing row changes meaning; nothing is backfilled (unknown stays
-- unknown).
--
--   S5  communication.meeting_assistants.outcomes   Q's post-call reading
--       (commitment signals SOFT/HARD with amount, currency, share and
--       condition apart; requests with who asked whom; promises), each tied
--       to a transcript line. Q_INFERENCE over USER_CLAIM, SELF_REPORTED.
--       network.diligence_requests gains the meeting it was asked in, the
--       reading item it came from and the due time as said.
--       network.commitments gains the condition said with the money.
--   S6  platform_ops.meeting_digests   the facilitation record for Capital
--       Q's admin: held, duration, counts, amounts, requests, next step.
--       Never the transcript. Server-only.
--       communication.meeting_host_notes kind SHARED_IN_CALL: the one chat
--       line posted in a live call after a document's owner approved the
--       share (idempotent per meeting and line).
--   S7  communication.meeting_follow_up_seen   Q has opened with a meeting's
--       follow-ups for this person once. Server-only.
--   S9  network.commitments.evidence_status (ADR-001 axis, apart from the
--       status) and evidence_document_id; network.commitment_notes
--       (append-only clauses, changes, notes); network.
--       commitment_review_flags, the admin review queue for claims the two
--       sides disagree on. A flag never changes either side's facts.
--       Capital Q never holds or moves money (decision 106).

-- S5 ------------------------------------------------------------------------

alter table communication.meeting_assistants
  add column outcomes jsonb
    check (outcomes is null or jsonb_typeof(outcomes) = 'object');

comment on column communication.meeting_assistants.outcomes is
  'S5: Q''s post-call reading (meeting-outcomes.v1): commitment signals, requests and promises, each with the transcript line, speaker and quote it rests on. Q_INFERENCE, SELF_REPORTED; never authoritative until the relevant side confirms.';

alter table network.diligence_requests
  add column meeting_id uuid references communication.meetings (id) on delete restrict,
  add column source_event_id uuid,
  add column due_text text
    check (due_text is null or (length(due_text) between 1 and 80 and due_text !~ '[[:cntrl:]]')),
  add constraint diligence_requests_source_needs_meeting
    check (source_event_id is null or meeting_id is not null);

comment on column network.diligence_requests.meeting_id is
  'S5: the call the request was asked in, when it came from Q''s record of it; null: asked in the app.';
comment on column network.diligence_requests.source_event_id is
  'S5: the item of Q''s post-call reading it came from (stable per meeting and line).';
comment on column network.diligence_requests.due_text is
  'S5: when it was asked for, as said ("friday"); null: no time said.';

-- One request per reading item: a second settle files nothing new.
create unique index diligence_requests_meeting_source_idx
  on network.diligence_requests (meeting_id, source_event_id)
  where meeting_id is not null and source_event_id is not null;

alter table network.commitments
  add column condition text
    check (condition is null or (length(condition) between 1 and 200 and condition !~ '[[:cntrl:]]'));

comment on column network.commitments.condition is
  'S5: the condition said with the money ("if diligence checks out"); null: none said.';

-- S9 ------------------------------------------------------------------------

-- ADR-001 evidence axis, kept apart from status (lifecycle) and level.
-- Only the grades Capital Q can stand behind today: nothing is
-- EXTERNALLY_VERIFIED or PLATFORM_VERIFIED without a verification source.
alter table network.commitments
  add column evidence_status text not null default 'SELF_REPORTED'
    check (evidence_status in ('SELF_REPORTED', 'DOCUMENT_SUPPORTED', 'MULTI_SOURCE_SUPPORTED')),
  add column evidence_document_id uuid references evidence.documents (id) on delete set null;

comment on column network.commitments.evidence_status is
  'S9: how well the latest step is corroborated (ADR-001): SELF_REPORTED one side said so; DOCUMENT_SUPPORTED a document backs it; MULTI_SOURCE_SUPPORTED both sides independently (confirmed, or sent with a reference and received). Fee reporting counts MULTI_SOURCE_SUPPORTED only.';
comment on column network.commitments.evidence_document_id is
  'S9: the document (signed terms, transfer confirmation) a side attached as evidence; null: none.';

create table network.commitment_notes (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,
  relationship_id          uuid not null references network.relationships (id) on delete restrict,
  commitment_id            uuid not null references network.commitments (id) on delete restrict,
  author_user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  side                     text not null check (side in ('COMPANY', 'INVESTOR')),
  kind                     text not null check (kind in ('NOTE', 'CLAUSE', 'CHANGE', 'EVIDENCE')),
  body                     text not null check (length(body) between 1 and 1000),
  -- CHANGE only: the amount this side says instead. Both values stand
  -- until the other side agrees; nothing is overwritten.
  proposed_amount          numeric check (proposed_amount is null or (proposed_amount > 0 and proposed_amount < 1e15)),
  proposed_currency_code   text check (proposed_currency_code is null or proposed_currency_code ~ '^[A-Z]{3}$'),
  document_id              uuid references evidence.documents (id) on delete set null,
  idempotency_key          text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at               timestamptz not null default clock_timestamp(),
  unique (commitment_id, idempotency_key),
  check ((proposed_amount is null) = (proposed_currency_code is null)),
  check (kind = 'CHANGE' or proposed_amount is null)
);

comment on table network.commitment_notes is
  'S9: clauses, changes, notes and evidence either side adds to a commitment. Append-only: a later note supersedes in reading only. Server-only; both parties read it through the server.';

create index commitment_notes_commitment_idx
  on network.commitment_notes (commitment_id, created_at);

create function private.network_commitment_notes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Decision 107: account deletion may only re-attribute the author; the
  -- words stay on the other side's record.
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.commitment_id = old.commitment_id
     and new.body = old.body then
    return new;
  end if;
  raise exception 'network.commitment_notes is append-only'
    using errcode = '55000';
end
$$;

revoke all on function private.network_commitment_notes_append_only() from public, anon, authenticated;

create trigger commitment_notes_append_only
  before update or delete on network.commitment_notes
  for each row execute function private.network_commitment_notes_append_only();

alter table network.commitment_notes enable row level security;
revoke all on network.commitment_notes from anon, authenticated;

create table network.commitment_review_flags (
  id                    uuid primary key default gen_random_uuid(),
  commitment_id         uuid not null references network.commitments (id) on delete restrict,
  relationship_id       uuid not null references network.relationships (id) on delete restrict,
  reason_code           text not null check (reason_code in (
                          'RECEIVED_WITHOUT_SENT', 'AMOUNT_MISMATCH')),
  detail                text not null check (length(detail) between 1 and 500),
  created_at            timestamptz not null default clock_timestamp(),
  reviewed_at           timestamptz,
  reviewed_by_user_id   uuid references identity.user_profiles (id) on delete set null,
  review_note           text check (review_note is null or length(review_note) between 1 and 1000),
  unique (commitment_id, reason_code),
  check (reviewed_at is not null or (reviewed_by_user_id is null and review_note is null))
);

comment on table network.commitment_review_flags is
  'S9: claims the two sides of a commitment disagree on, for Capital Q''s admin to review. A flag never changes either side''s facts and is never shown to the other party. Server-only.';

alter table network.commitment_review_flags enable row level security;
revoke all on network.commitment_review_flags from anon, authenticated;

-- S6 ------------------------------------------------------------------------

create table platform_ops.meeting_digests (
  meeting_id         uuid primary key references communication.meetings (id) on delete restrict,
  relationship_id    uuid not null references network.relationships (id) on delete restrict,
  held_at            timestamptz not null,
  duration_seconds   integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  soft_signals       integer not null default 0 check (soft_signals between 0 and 100),
  hard_signals       integer not null default 0 check (hard_signals between 0 and 100),
  -- [{level, amount (exact decimal string), currencyCode (null: not said)}]
  amounts            jsonb not null default '[]'::jsonb check (jsonb_typeof(amounts) = 'array'),
  requests           integer not null default 0 check (requests between 0 and 100),
  request_items      jsonb not null default '[]'::jsonb check (jsonb_typeof(request_items) = 'array'),
  next_step          text check (next_step is null or length(next_step) between 1 and 200),
  created_at         timestamptz not null default clock_timestamp()
);

comment on table platform_ops.meeting_digests is
  'S6: the facilitation record of a held meeting for Capital Q''s admin (its fee for facilitating meetings): held, duration, money signals by level, requests, next step. Never the transcript, a quote or either side''s private Q analysis. Platform admin only, through the server.';

create index meeting_digests_held_idx on platform_ops.meeting_digests (held_at desc);

alter table platform_ops.meeting_digests enable row level security;
revoke all on platform_ops.meeting_digests from anon, authenticated;

-- S6b: the in-call share line, once per meeting and line.
alter table communication.meeting_host_notes
  drop constraint meeting_host_notes_kind_check,
  add constraint meeting_host_notes_kind_check
    check (kind in ('PROPOSAL', 'NO_SHOW', 'ONE_SIDED', 'RESCHEDULE_WANTED', 'NEVER_MIND',
                    'LEAVE_REQUESTED', 'REMOVED', 'UNRECORDED', 'SHARED_IN_CALL'));

create unique index meeting_host_notes_shared_once_idx
  on communication.meeting_host_notes (meeting_id, body)
  where kind = 'SHARED_IN_CALL';

-- S7 ------------------------------------------------------------------------

create table communication.meeting_follow_up_seen (
  meeting_id   uuid not null references communication.meetings (id) on delete restrict,
  user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  tenant_id    uuid not null references identity.tenants (id) on delete restrict,
  seen_at      timestamptz not null default clock_timestamp(),
  primary key (meeting_id, user_id)
);

comment on table communication.meeting_follow_up_seen is
  'S7: Q has opened a conversation with this meeting''s follow-ups for this person, so it does not open with them again. Server-only.';

alter table communication.meeting_follow_up_seen enable row level security;
revoke all on communication.meeting_follow_up_seen from anon, authenticated;
