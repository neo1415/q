-- AUTO (founder direction 2026-10-02): booking without Google, and the
-- other side hearing about what Q does.
--
-- 1. An errand whose owner has no Google calendar negotiates the time in
--    the relationship chat, as a human assistant would: Q proposes slots
--    from the owner's working hours in their own time zone, reads the
--    reply by meaning, and records the agreed meeting. The slots Q
--    proposed are kept with the errand so the reply is read against
--    exactly what was offered, however late it comes.
-- 2. Notices for the side Q acts towards: an incoming interest or
--    connection request, the first message Q sends on someone's behalf,
--    and a proposed time.

alter table q_runtime.errands
  add column proposed_slots jsonb check (
    proposed_slots is null
    or (jsonb_typeof(proposed_slots) = 'array' and jsonb_array_length(proposed_slots) between 1 and 5)),
  add column proposed_at timestamptz,
  add constraint errands_proposed_together check ((proposed_slots is null) = (proposed_at is null));

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED'));
