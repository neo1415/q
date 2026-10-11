-- D (2026-10-11, founder ask P3): the meeting event record. What happened in a
-- call Q hosted, append-only: who said it, when, and whether it is a question,
-- an agreement, a disagreement, a proposal, something pending approval, a
-- commitment, an action item, a correction, a held note, a working summary or a
-- proposed follow-up. Kept apart from audit (who acted under whose authority),
-- from Q memory, and from the host notes (what Q noted for the organiser).
--
-- Suggestion, tentative and commitment are different stances. An owner and a
-- due time exist ONLY on a commitment, so a suggestion can never read as
-- someone's promise. Corrections and compaction add events; nothing is
-- updated or deleted. Server-only: the application authorises the writer
-- (the host runtime, bound to a meeting it hosts); no browser role reads it.
-- Forward-only and additive.

create table communication.meeting_events (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid not null references communication.meetings (id) on delete restrict,
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  seq              integer not null check (seq >= 1),
  occurred_at      timestamptz not null,
  -- The person as Capital Q identified them; null: unknown stays unknown.
  speaker_name     text check (length(speaker_name) between 1 and 200),
  speaker_user_id  uuid references identity.user_profiles (id) on delete restrict,
  speaker_side     text check (speaker_side in ('FOUNDER', 'INVESTOR')),
  kind             text not null check (kind in (
                     'QUESTION', 'AGREEMENT', 'DISAGREEMENT', 'PROPOSAL', 'PENDING_APPROVAL',
                     'COMMITMENT', 'ACTION_ITEM', 'CORRECTION', 'NOTE', 'SUMMARY', 'FOLLOW_UP')),
  stance           text check (stance in ('SUGGESTION', 'TENTATIVE', 'COMMITMENT')),
  body             text not null check (length(btrim(body)) between 1 and 2000),
  owner_name       text check (length(owner_name) between 1 and 200),
  owner_user_id    uuid references identity.user_profiles (id) on delete restrict,
  due_text         text check (length(due_text) between 1 and 100),
  -- The earlier event this accepts, disputes, answers or corrects.
  refers_to        uuid references communication.meeting_events (id) on delete restrict,
  -- Transcript lines and snapshot facts it rests on ("line:42", "s:c1").
  source_refs      jsonb not null default '[]'::jsonb
                     check (jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) <= 20),
  created_at       timestamptz not null default clock_timestamp(),
  unique (meeting_id, seq),
  -- A commitment is a COMMITMENT stance; only it names an owner or a due time.
  check (kind <> 'COMMITMENT' or stance is not null),
  check (stance = 'COMMITMENT' or (owner_name is null and owner_user_id is null and due_text is null)),
  check (kind not in ('QUESTION', 'AGREEMENT', 'DISAGREEMENT', 'CORRECTION', 'SUMMARY', 'FOLLOW_UP') or stance is null)
);

comment on table communication.meeting_events is
  'Append-only record of a hosted call: speaker, time, question, agreement, disagreement, proposal, pending approval, commitment, action item, correction, working summary, proposed follow-up. Stance separates suggestion, tentative and commitment; owner/due only on a commitment. Compaction adds a SUMMARY and never removes events. Not audit, not Q memory, not analytics.';

create index meeting_events_meeting_idx
  on communication.meeting_events (meeting_id, seq);
create index meeting_events_refers_idx
  on communication.meeting_events (refers_to) where refers_to is not null;

create function private.meeting_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'communication.meeting_events is append-only; record a correction instead'
    using errcode = '55000';
end
$$;

revoke all on function private.meeting_events_append_only() from public, anon, authenticated;

create trigger meeting_events_append_only
  before update or delete on communication.meeting_events
  for each row execute function private.meeting_events_append_only();

alter table communication.meeting_events enable row level security;

-- No policy and no grant for authenticated or anon: server-only.
revoke all on communication.meeting_events from anon, authenticated;
