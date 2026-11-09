-- D82 (owner live 2026-11-09) · the files a person's turn carried.
--
-- "It's not even in the chat": a document attached in Q's composer went
-- with the turn (its id on the run's screen context) but the turn itself
-- kept no record of it, so after a reload nothing showed it was ever
-- attached, and nothing could tell which turn it belonged to.
--
-- One additive, nullable column on the person's own turns: the documents
-- the turn carried, each its id and its title as Evidence named it to the
-- person when the turn was written. Deliberately narrow: an array of at
-- most five small objects, bounded in size, on USER rows only.
--
-- What this is not: authorisation. An id here is a reference, never a
-- grant; reading the document still goes through Evidence as the reader.
-- The table's visibility is unchanged: RLS on, no policies, no browser
-- grants. The column follows the row.

alter table q_runtime.conversation_messages
  add column attachments jsonb
    check (attachments is null or jsonb_typeof(attachments) = 'array'),
  add constraint conversation_messages_attachments_bounded
    check (
      attachments is null
      or (jsonb_array_length(attachments) between 1 and 5
          and length(attachments::text) <= 4000)
    ),
  -- Only a person's turn carries what they attached.
  add constraint conversation_messages_attachments_role
    check (attachments is null or role = 'USER');

comment on column q_runtime.conversation_messages.attachments is
  'The documents a person''s turn carried (at most five): each {documentId, title}, the title as Evidence named it to them when the turn was written. A reference, never a grant: reading a document re-checks access as the reader.';
