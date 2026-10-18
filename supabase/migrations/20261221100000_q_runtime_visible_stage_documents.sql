-- RECOVERY-2026-10 · The run's visible stage accepts the document stages.
--
-- QVisibleStage (packages/contracts/src/q/stage.ts) gained the document
-- stages, but run_events' CHECK (20260917090000) was never widened: live
-- 2026-10-09, "q specialist stage event not recorded … violates check
-- constraint run_events_visible_stage_check", so a person never saw those
-- stages. Fix forward: the same closed vocabulary, now complete. Still a
-- bounded list, never free text or chain-of-thought.

alter table q_runtime.run_events drop constraint if exists run_events_visible_stage_check;

alter table q_runtime.run_events
  add constraint run_events_visible_stage_check check (
    visible_stage is null or visible_stage in (
      'UNDERSTANDING_REQUEST', 'REVIEWING_COMPANY', 'CHECKING_EVIDENCE',
      'SEARCHING_PUBLIC_SOURCES', 'REVIEWING_INVESTOR_CRITERIA',
      'COMPARING_OPPORTUNITIES', 'REVIEWING_RELATIONSHIP', 'PREPARING_ANALYSIS',
      'PREPARING_DOCUMENT', 'REVISING_DOCUMENT', 'DESIGNING_DOCUMENT',
      'FINDING_DOCUMENT_IMAGES', 'CHECKING_DOCUMENT',
      'WAITING_FOR_REPLY', 'WAITING_FOR_APPROVAL', 'COMPLETING_APPROVED_ACTION'
    )
  );
