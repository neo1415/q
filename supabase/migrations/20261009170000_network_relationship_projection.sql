-- CQ-NET-012 · the relationship state projection's bookkeeping (doc 25
-- §120: "derive current state from event history; do not overwrite
-- history"; doc 13 §28.3).
--
--   current_state ≠ history. The history (network.relationship_events) is
--   the authority; current_state is a cache of a deterministic fold over it.
--
-- Three columns say which fold produced the cached state, so a projection
-- can be written idempotently and never backwards:
--
--   projected_sequence  the last history sequence the fold included
--   projector_version   the versioned rule set that folded it
--   projected_at        when the cache was written (not when the state began;
--                       state_updated_at is the occurred_at of the event that
--                       moved it)
--
-- A writer may only replace a projection with one that folded further, or
-- with the same reach under a different projector version (a rebuild). The
-- deterministic projector is the only writer; no command sets a state.

alter table network.relationships
  add column projected_sequence bigint not null default 0
    check (projected_sequence >= 0),
  add column projector_version text not null default 'none'
    check (projector_version ~ '^[a-z][a-z0-9.-]{0,63}$'),
  add column projected_at timestamptz;

-- A fold can never claim history that does not exist yet.
alter table network.relationships
  add constraint relationships_projection_within_history
    check (projected_sequence <= last_event_sequence);

comment on column network.relationships.current_state is
  'Derived projection of the ordered history, written only by the deterministic relationship-state projector (CQ-NET-012). DISCOVERED | INTEREST_EXPRESSED | CONNECTED | DECLINED in relationship-state.v1. Never patched by a command.';
comment on column network.relationships.projected_sequence is
  'The last relationship_events.sequence folded into current_state. Less than last_event_sequence means the projection is catching up.';
comment on column network.relationships.projector_version is
  'The projector rule set that produced current_state; ''none'' until the first projection.';

-- Rebuild and catch-up scans find relationships whose cache is behind.
create index relationships_projection_lag_idx
  on network.relationships (id)
  where projected_sequence < last_event_sequence;
