-- CQ-Q-BLOCKS-HISTORY-001 · Q's structured answer, after the stream ends.
--
-- A Q answer is prose plus the objects it referred to: a company, a
-- finding, something it could not establish, a question back. Those
-- objects reached the browser on the run's durable completion event and
-- nowhere else, so they survived a reconnect and vanished on a refresh.
-- Reopening a conversation from history showed the words and lost
-- everything you could act on.
--
-- The column is deliberately narrow. The table's own comment warns that an
-- unbounded text column here is where a provider's entire response object
-- would eventually land, and the same is true of an unbounded jsonb one.
-- So: bounded by size, restricted to Q's own turns, and — the part that
-- actually holds — written only through the public result-block contract,
-- which has no member that could carry chain-of-thought, a tool scratchpad,
-- a retrieval chunk or a provider payload. What cannot be expressed in that
-- contract cannot be stored here.
--
-- What this is not: authorisation. A block naming a company is a reference,
-- not a grant. Reading one back still resolves through the same checks the
-- live answer did, because knowing an identifier has never been permission
-- to see what it names.

alter table q_runtime.conversation_messages
  add column result_blocks jsonb
    check (result_blocks is null or jsonb_typeof(result_blocks) = 'array'),
  -- Roughly the size of Q's own text bound. Generous for a handful of
  -- objects, far too small for anything that should not be here.
  add constraint conversation_messages_result_blocks_bounded
    check (result_blocks is null or length(result_blocks::text) <= 32000),
  -- Only Q's turns carry structure. A person's turn is what they typed.
  add constraint conversation_messages_result_blocks_role
    check (result_blocks is null or role = 'Q');

comment on column q_runtime.conversation_messages.result_blocks is
  'The public result blocks of a Q answer, exactly as the browser received them live: the objects it referred to, its findings, what it could not establish. Validated through the public Q result-block contract on write, so no internal state, provider payload or private evidence reference can be expressed here. A reference is not authorisation; reading one back re-checks access.';
