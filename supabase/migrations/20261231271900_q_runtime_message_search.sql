-- Search over a person's own past Q turns (Q intelligence step 9).
--
-- "What did we say about Ledgerline last week?" is answered from the
-- person's own earlier conversations: the words they and Q actually used,
-- not a model-written summary. The Q API runs a full-text search over
-- q_runtime.conversation_messages, scoped by code to the conversation's
-- tenant and owner (q_runtime.conversations.user_id), never the request,
-- and leaves out archived conversations and marked lines
-- (20261110030000). Authorisation is resolved before the search: the Q
-- API only searches when the run's Context Firewall plan admits the
-- person's own conversations.
--
-- Additive only: one expression index. No column, no data change, and no
-- change to visibility: q_runtime.conversation_messages keeps RLS on, no
-- policies and no client grants, so a browser principal still reads no
-- row of anyone's.
--
-- `english` is a literal on purpose: the query side parses the person's
-- words with the same configuration (as q_knowledge.chunks.content_tsv),
-- so lexemes match.

create index conversation_messages_content_search_idx
  on q_runtime.conversation_messages
  using gin (to_tsvector('english', content));

comment on index q_runtime.conversation_messages_content_search_idx is
  'Full-text search over a person''s own past Q turns (step 9). Read only by the Q API, scoped to the conversation''s tenant and owner.';
