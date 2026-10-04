-- Fix forward (lead 2026-10-04): the founder's live call (meeting 21d82131,
-- assistant 80b4e357) was recorded at 18:42 but its notices, recap emails and
-- follow-up cards never went out (notification link rejected, a broken
-- follow-up query). build/meet2-64 fixes both and makes settlement
-- idempotent (meeting_held once per meeting, money keyed per meeting).
-- Returning the assistant to IN_CALL lets the collector settle it again from
-- Recall's kept transcript. A no-op if it is not DONE.

update communication.meeting_assistants
   set status = 'IN_CALL', updated_at = clock_timestamp()
 where id = '80b4e357-6731-473d-ac2f-e1df64b84245'
   and status = 'DONE';
