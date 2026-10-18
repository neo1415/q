-- Marks on conversation messages: lines that are not part of what Q may
-- read back (founder live 2026-10-01).
--
-- With Capital Q's voice open, speech meant for someone else was stored as
-- the person's turns: a name said to somebody in the room ("Neo, n e u")
-- and a long dictation to their developer. Q later called them "Neo" and
-- answered "summarize everything here" from the dictation.
--
-- conversation_messages stays append-only history. A mark is a separate,
-- append-only row that says a message is not to be read back as the
-- person's words: NOT_ADDRESSED_TO_Q (the turn reader read it as speech
-- for someone else, or the person said so) or HIDDEN_BY_PERSON (they
-- asked for it to be kept out). A marked message is left out of the
-- conversation Q reads, of the turn reader's recent turns, of retrieval
-- queries and of anything learned into memory or knowledge. Nothing is
-- deleted, and history still shows what was said and when.

create table q_runtime.conversation_message_marks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  conversation_id     uuid not null,
  message_id          uuid not null,
  mark                text not null check (mark in ('NOT_ADDRESSED_TO_Q', 'HIDDEN_BY_PERSON')),
  -- Who decided: the turn reader's reading (Q_READING) or the person.
  marked_by           text not null check (marked_by in ('Q_READING', 'PERSON')),
  -- The run whose reading or request made the mark, when there is one.
  run_id              uuid,
  created_at          timestamptz not null default clock_timestamp(),

  foreign key (message_id, tenant_id)
    references q_runtime.conversation_messages (id, tenant_id) on delete restrict,
  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete restrict,
  unique (message_id, mark)
);

comment on table q_runtime.conversation_message_marks is
  'Append-only marks that keep a conversation message out of what Q reads back (context, reader turns, retrieval, memory). History is never rewritten.';

create index conversation_message_marks_conversation_idx
  on q_runtime.conversation_message_marks (conversation_id, message_id);

create function q_runtime.protect_conversation_message_marks() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.conversation_message_marks is append-only'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.protect_conversation_message_marks() from public;

create trigger conversation_message_marks_append_only
  before update or delete on q_runtime.conversation_message_marks
  for each row execute function q_runtime.protect_conversation_message_marks();

-- As every q_runtime table: no policies and no client grants. The Q API is
-- the boundary and writes a mark only for the conversation's own owner.
alter table q_runtime.conversation_message_marks enable row level security;
