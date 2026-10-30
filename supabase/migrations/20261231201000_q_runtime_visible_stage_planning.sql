-- Q fast lane 2 · The run's visible stage accepts the planning stages.
--
-- QVisibleStage (packages/contracts/src/q/stage.ts) gained
-- GATHERING_SITUATION, READING_DOCUMENTS, DRAFTING_PLAN and REVIEWING_PLAN
-- (situation-first planning, 2026-10-28), but run_events' CHECK
-- (20261221100000) was not widened. Live 2026-10-30, "What should I do
-- today?": the answer recorded GATHERING_SITUATION, the insert violated
-- run_events_visible_stage_check, showStage logged "q specialist stage event
-- not recorded", and the person only ever saw "Pulling it together". Fix
-- forward: the same closed vocabulary, now complete. Still a bounded list,
-- never free text or chain-of-thought. The contract test
-- packages/q-runtime/test/visible-stage-check.test.ts keeps the two equal.

alter table q_runtime.run_events drop constraint if exists run_events_visible_stage_check;

alter table q_runtime.run_events
  add constraint run_events_visible_stage_check check (
    visible_stage is null or visible_stage in (
      'UNDERSTANDING_REQUEST', 'REVIEWING_COMPANY', 'CHECKING_EVIDENCE',
      'SEARCHING_PUBLIC_SOURCES', 'REVIEWING_INVESTOR_CRITERIA',
      'COMPARING_OPPORTUNITIES', 'REVIEWING_RELATIONSHIP', 'PREPARING_ANALYSIS',
      'PREPARING_DOCUMENT', 'REVISING_DOCUMENT', 'DESIGNING_DOCUMENT',
      'FINDING_DOCUMENT_IMAGES', 'CHECKING_DOCUMENT',
      'WAITING_FOR_REPLY', 'WAITING_FOR_APPROVAL', 'COMPLETING_APPROVED_ACTION',
      'GATHERING_SITUATION', 'READING_DOCUMENTS', 'DRAFTING_PLAN',
      'REVIEWING_PLAN'
    )
  );
