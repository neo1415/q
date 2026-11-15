-- GateQ: whether Q's close stands after a Q turn (live defect 2026-11-15,
-- re-certification 5757518c7: "That's everything I need for now" was said
-- at turn 13 and again at turn 45).
--
-- Whether Q had already said its close was read from the words of the last
-- eight turns, so once the close aged out of that window Q said it again.
-- The interviewer now decides each reply's ending from the plan and stores
-- the outcome with the Q turn it wrote:
--
--   * true: the plan has nothing left, Q asked nothing, and its close has
--     been said (this turn or an earlier one, with nothing reopened since);
--   * null: it does not (any PERSON turn, any Q turn that asked something,
--     every turn written before this column).
--
-- The next turn reads it from the latest Q turn: the full close is said
-- once when the plan first empties; later turns only point to "Finish and
-- review". New information that reopens the plan writes a Q turn without it,
-- which clears it. Turns stay append-only: each row records the state after
-- its own reply, never updated.
--
-- Server-only, like every gateq table: RLS on, no policy, no browser grant.
-- No backfill: an older interview reads as "not said", so at most one close
-- is said again on its next turn.

alter table gateq.application_turns
  add column ready_to_close boolean;

alter table gateq.application_turns
  add constraint application_turns_ready_to_close_shape check (
    ready_to_close is null or (role = 'Q' and ready_to_close)
  );

comment on column gateq.application_turns.ready_to_close is
  'Q turns only: true when the plan had nothing left, Q asked nothing and its close had been said; null otherwise. Read from the latest Q turn so the close is said once.';
