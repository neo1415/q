-- A declared action waiting on the person's reply (QA runs 7d7e7260 ->
-- 5c2f71aa): Q asked one thing it needs (their city, for a reminder's
-- time) and the next turn continues that action. Kept on the
-- conversation so it outlives a restart or another q-api instance; read
-- once, by the server only. Additive: no existing row changes.

alter table q_runtime.conversations
  add column awaiting_action jsonb
    check (awaiting_action is null
           or (jsonb_typeof(awaiting_action) = 'object'
               and length(awaiting_action::text) <= 8192));

comment on column q_runtime.conversations.awaiting_action is
  'The declared action Q is waiting to continue on the person''s reply: {tool, arguments, needs, at}. Server-written, read once and cleared; never a source of fact.';
