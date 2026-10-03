-- A rehearsal the founder ended themselves (lead 2026-10-03, QA): it was
-- recorded LEFT_EARLY, which reads as the played person walking out.
-- Additive: the closed set of outcomes gains FOUNDER_ENDED; no existing
-- row changes (rows the founder ended before this stay LEFT_EARLY).

alter table q_runtime.rehearsals
  drop constraint rehearsals_outcome_check,
  add constraint rehearsals_outcome_check
    check (outcome is null or outcome in (
      'INDECISIVE', 'STRONG_LATER', 'ADJOURNED', 'DEAL_AGREED', 'DECLINED',
      'LEFT_EARLY', 'FOUNDER_ENDED'));
