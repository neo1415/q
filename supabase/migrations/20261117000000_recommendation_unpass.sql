-- Undo pass (doc 19 §66-68; founder report 2026-10-02): an investor may
-- reset a pass, and the company comes back into proactive discovery from
-- the next page served. UNPASS is an interaction event like UNSAVE: the
-- history keeps the pass and its undoing, append-only, and
-- interaction_state is the fold. It never touches the mandate: a pass
-- was never a hard exclusion, and undoing one is not a rule change.

alter table recommendation.interaction_events
  drop constraint interaction_events_interaction_type_check,
  add constraint interaction_events_interaction_type_check
    check (interaction_type in (
      'IMPRESSION', 'WATCH_MILESTONE', 'PROFILE_OPEN', 'ASK_Q',
      'SAVE', 'UNSAVE', 'PASS', 'UNPASS', 'INTEREST_OBSERVED'));
