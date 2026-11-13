-- Journey audit 2026-11-13 D1: the side that expressed interest is never
-- told the other side accepted it (the investor's data-room gate promises
-- "You'll get a notification"). The workers' interest-notice handler now
-- writes INTEREST_ACCEPTED on network.relationship.matched, once per
-- interest (dedupe_key interest_accepted:<interest id>), to the expressing
-- organisation's active members only.
--
-- Widening a CHECK is a drop and re-add (the 20261231410000 precedent);
-- every existing value is kept, in the same order, and the pgTAP suite
-- proves each one still passes. Needs the migrator's --founder-approved
-- flag (it refuses DROP otherwise). Apply before deploying the workers
-- that write the kind; until then the handler logs and skips the notice.

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
                    'COMMITMENT', 'STARTUP_ALERT', 'COMPANY_SAVED', 'VIEWING_DIGEST',
                    'INTEREST_ACCEPTED'));
