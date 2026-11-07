-- Q Workspace §8 A6 (owner 2026-11-07: "build it regardless; we switch
-- things on and off"): two notice kinds for a company's founders, each
-- behind an admin setting in analytics.platform_settings.
--
--   COMPANY_SAVED   an investor saved the company (an intent signal,
--                   §6.7.12), worded at the saver's own viewing level;
--                   intent_signal_notifications, default ON.
--   VIEWING_DIGEST  the week's passive viewing, aggregate only and above
--                   the floor; passive_view_notifications, default OFF.
--
-- Widening a CHECK is a drop and re-add (the STARTUP_ALERT precedent,
-- 20261209132000); every existing value is kept, in the same order, and the
-- pgTAP suite proves each one still passes. Applied with the migrator's
-- --founder-approved flag (it refuses DROP otherwise). The delivery ticker
-- pushes and emails every notice as it already does; nothing new sends.

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
                    'COMMITMENT', 'STARTUP_ALERT', 'COMPANY_SAVED', 'VIEWING_DIGEST'));
