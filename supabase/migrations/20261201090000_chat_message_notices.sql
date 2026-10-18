-- QA run 8a1d57b9: neither side was told of a new chat message. The
-- recipient of every new message (sent by a person or by Q for them) gets
-- one notice per conversation, raised again when a new message arrives
-- after they read it (dedupe key `chat:<conversation id>`; the words are
-- never copied into it).
--
-- Additive: widens the kind check by CHAT_MESSAGE. EMAIL_RECEIVED is kept
-- in the list so this check, applied after 20261130090000 (inbound email),
-- never narrows what that migration allows.

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE'));
