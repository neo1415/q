-- CQ-Q-VOICE-001 R1 · q_runtime.run_events.visible_stage admits SEARCHING_PUBLIC_SOURCES
--
-- CQ-Q-RESEARCH-001 added one approved visible stage to the QVisibleStage
-- contract — "Searching public sources" — for the moment Q reads the public
-- web through the Tool Registry. The contract and the web label shipped;
-- the CHECK constraint written in 20260906120000 still enumerated the
-- original ten stages, so the runtime fell back to CHECKING_EVIDENCE.
--
-- Additive and forward: every value that was legal stays legal, one is
-- added, the column stays a bounded vocabulary (never free text), and no
-- run status semantics change. The constraint keeps its generated name so
-- the runtime's error mapping and the RLS suite see the same object.
--
-- Rollback: dropping the constraint and re-adding it without
-- 'SEARCHING_PUBLIC_SOURCES' fails while any row carries that stage;
-- such rows would have to be rewritten to 'CHECKING_EVIDENCE' first.

alter table q_runtime.run_events
  drop constraint run_events_visible_stage_check;

alter table q_runtime.run_events
  add constraint run_events_visible_stage_check check (
    visible_stage is null or visible_stage in (
      'UNDERSTANDING_REQUEST', 'REVIEWING_COMPANY', 'CHECKING_EVIDENCE',
      'REVIEWING_INVESTOR_CRITERIA', 'COMPARING_OPPORTUNITIES', 'REVIEWING_RELATIONSHIP',
      'PREPARING_ANALYSIS', 'WAITING_FOR_REPLY', 'WAITING_FOR_APPROVAL',
      'COMPLETING_APPROVED_ACTION',
      -- CQ-Q-RESEARCH-001: Q is reading public sources through the Tool Registry.
      'SEARCHING_PUBLIC_SOURCES'
    )
  );

comment on column q_runtime.run_events.visible_stage is
  'QVisibleStage: the approved, high-level vocabulary a person may be shown while a run works. Bounded by CHECK; never chain-of-thought.';
