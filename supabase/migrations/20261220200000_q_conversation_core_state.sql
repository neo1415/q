-- RECOVERY-2026-10 B3 (audit B-02): the conversation core's state -- unclear
-- turns in a row, the last action ("try again", "same for X"), a question
-- series in progress, the last tool focus -- kept on the conversation so a
-- deploy or a second q-api instance continues the thread. It was held in
-- process memory only. Same pattern as awaiting_action (20261129090000):
-- one server-written jsonb column, size-checked, never a source of fact.
-- q_runtime has no client grants (20260906120000), so only the Q API
-- reads or writes it. Additive: no existing row changes.

alter table q_runtime.conversations
  add column core_state jsonb
    check (core_state is null
           or (jsonb_typeof(core_state) = 'object'
               and length(core_state::text) <= 16384));

comment on column q_runtime.conversations.core_state is
  'The conversation core''s state: {v, unclearInARow, lastAction, sequence, focus}. Server-written after each turn, validated on read; conversational texture, never a source of fact.';
