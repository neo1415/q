-- DECISIONS 103 (owner, 2026-11-17): when every configured search index is
-- spent or unavailable, Q's public research may fall back to the Claude
-- API's own web search tool. Those calls are recorded under their own
-- purpose, so the ledger tells them apart and their own daily cap
-- (Q_MODEL_SEARCH_DAILY_USD_CAP) sums only them.
--
-- Additive only: PUBLIC_WEB_SEARCH joins the closed purpose set. Existing
-- rows and every other purpose are unchanged; who may read the ledger is
-- unchanged. Apply before deploying the code that writes the new purpose.

alter table ai_ops.model_usage drop constraint model_usage_purpose_check;
alter table ai_ops.model_usage add constraint model_usage_purpose_check
  check (purpose in ('CONVERSATION', 'INSTRUCTION', 'DELEGATED_WORK', 'REHEARSAL',
                     'RESEARCH', 'ONBOARDING', 'MEETING', 'DOCUMENT', 'VOICE_REALTIME',
                     'WARMUP', 'PUBLIC_WEB_SEARCH', 'OTHER'));
