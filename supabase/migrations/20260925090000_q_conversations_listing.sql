-- Conversations a person can come back to (ADR 0012; doc 13 §38, doc 17).
--
-- A conversation existed only as the thing a run pointed at: no title, no
-- summary, no way to list a person's conversations, so a refresh lost the
-- thread and the browser remembered run ids in local storage to pretend
-- otherwise. Three additions make a conversation a thing of its own:
--
--   title            a few words the memory extractor names it by; null
--                    until it has run, when the first turn stands in.
--   summary          the conversation so far, rolled forward after each
--                    turn (working memory, doc 14 §55.1). Model-written,
--                    marked untrusted wherever it is rendered, and never a
--                    source of fact: what was said is in the messages.
--   last_message_at  maintained by the message insert, so listing a
--                    person's conversations is one index scan.
--
-- No visibility change: a conversation is still readable by its owner in
-- its tenant and nobody else, and the table stays server-internal.
alter table q_runtime.conversations
  add column title            text
    check (title is null or length(title) <= 120),
  add column summary          text
    check (summary is null or length(summary) <= 4000),
  -- The newest message the summary covers, so a summary is never taken
  -- for more than it is.
  add column summary_through  timestamptz,
  add column last_message_at  timestamptz;

comment on column q_runtime.conversations.title is
  'A few words naming the conversation, written by the memory extractor and shown in the list of conversations. Null until it has run.';
comment on column q_runtime.conversations.summary is
  'The conversation so far, rolled forward after each turn. Model-written working memory: rendered as untrusted, never a source of fact.';

update q_runtime.conversations c
   set last_message_at = (
     select max(m.created_at)
       from q_runtime.conversation_messages m
      where m.conversation_id = c.id
        and m.tenant_id = c.tenant_id)
 where c.last_message_at is null;

-- A person's open conversations, newest activity first.
create index conversations_owner_recent_idx
  on q_runtime.conversations (tenant_id, user_id, coalesce(last_message_at, created_at) desc)
  where archived_at is null;

-- The newest messages of one conversation, for reopening it.
create index conversation_messages_conversation_recent_idx
  on q_runtime.conversation_messages (tenant_id, conversation_id, created_at desc, id desc);
