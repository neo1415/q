-- RECOVERY F6 (audit F-D10): the duplex voice transcript can be deleted.
--
-- q_runtime.voice_line_turns is owner-private interaction history. Its
-- retention followed only the linked conversation (cascade), so two kinds
-- of row could never go:
--
--   * turns of a line that never reached a Q conversation
--     (conversation_id is null): the workers' retention job now purges
--     them after 30 days (apps/workers/src/retention/voice-line-turns.ts);
--   * any turn of a person being erased: user_id was ON DELETE RESTRICT,
--     so the transcript blocked the erasure of the person it belongs to.
--     A person's private transcript goes with them.
--
-- The tenant FK stays RESTRICT: a tenant is never deleted out from under
-- its people's history by a cascade.

alter table q_runtime.voice_line_turns
  drop constraint voice_line_turns_user_id_fkey;

alter table q_runtime.voice_line_turns
  add constraint voice_line_turns_user_id_fkey
  foreign key (user_id) references identity.user_profiles (id) on delete cascade;

-- The purge reads orphans by age; the session index leads with tenant.
create index voice_line_turns_orphan_spoken_idx
  on q_runtime.voice_line_turns (spoken_at)
  where conversation_id is null;

-- The retention job deletes, so the service role needs it; browsers still
-- hold nothing.
grant delete on q_runtime.voice_line_turns to postgres, service_role;

comment on table q_runtime.voice_line_turns is
  'The full-duplex voice line transcript, both sides, with who answered each turn (ask_q, smalltalk, model_only). Owner-private, server-only; never canonical business truth, never a prompt. Retention: linked turns go with their conversation; unlinked turns are purged after 30 days by the workers; every turn goes with its person.';
