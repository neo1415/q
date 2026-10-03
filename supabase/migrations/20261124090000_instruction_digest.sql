-- ADR 0043 S7: when Q last summed up a standing instruction for its owner.
-- The cadence itself is part of the approved grant. Additive.

alter table q_runtime.standing_instructions
  add column last_digest_at timestamptz;

create index standing_instructions_digest_idx
  on q_runtime.standing_instructions (last_digest_at nulls first)
  where status in ('ACTIVE', 'PAUSED');
