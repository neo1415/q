-- ADR 0039 (live 2026-10-02): Q is the meeting's record for both sides.
-- Additive: three more kinds of host note, append-only as before --
-- LEAVE_REQUESTED (someone asked Q in the call to leave; Q stayed),
-- REMOVED (the organiser ended Q's recording from Capital Q: who, when),
-- UNRECORDED (the part of the meeting with no record, and why).

alter table communication.meeting_host_notes
  drop constraint meeting_host_notes_kind_check,
  add constraint meeting_host_notes_kind_check
    check (kind in ('PROPOSAL', 'NO_SHOW', 'ONE_SIDED', 'RESCHEDULE_WANTED', 'NEVER_MIND',
                    'LEAVE_REQUESTED', 'REMOVED', 'UNRECORDED'));

comment on table communication.meeting_host_notes is
  'What Q noted in or about a call it hosted (MEET-HOST, ADR 0039): proposals for the organiser to approve after the call (never acted on in the call), no-show outcomes, requests in the call for Q to leave (Q stays), the organiser''s removal of Q, and unrecorded portions. Append-only.';
