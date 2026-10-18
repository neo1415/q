-- ADR 0043 S4: when a standing instruction runs. A firing is claimed by
-- moving next_fire_at forward in the same statement that selects it
-- (skip locked), so two q-api instances never fire the same instruction at
-- once. A relationship event brings next_fire_at forward. Additive.

alter table q_runtime.standing_instructions
  add column next_fire_at   timestamptz,
  add column last_fired_at  timestamptz,
  add column cadence_minutes integer not null default 240
    check (cadence_minutes between 30 and 10080);

comment on column q_runtime.standing_instructions.next_fire_at is
  'When Q next works on this instruction; null means as soon as possible.';

create index standing_instructions_due_idx
  on q_runtime.standing_instructions (next_fire_at nulls first)
  where status = 'ACTIVE';
