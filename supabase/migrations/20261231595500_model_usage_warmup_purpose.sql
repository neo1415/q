-- DECISIONS 101 (owner, 2026-11-16): the reader warm-up. When someone opens
-- Q after the turn reader's route has been idle for 15 minutes or more, q-api
-- makes one tiny call on that route (no person's content, result discarded)
-- so the first question does not pay a cold start. Those calls are recorded
-- under their own purpose, so the ledger tells them apart from real Q work.
--
-- Additive only: WARMUP joins the closed purpose set. Existing rows and every
-- other purpose are unchanged; who may read the ledger is unchanged.

alter table ai_ops.model_usage drop constraint model_usage_purpose_check;
alter table ai_ops.model_usage add constraint model_usage_purpose_check
  check (purpose in ('CONVERSATION', 'INSTRUCTION', 'DELEGATED_WORK', 'REHEARSAL',
                     'RESEARCH', 'ONBOARDING', 'MEETING', 'DOCUMENT', 'VOICE_REALTIME',
                     'WARMUP', 'OTHER'));
