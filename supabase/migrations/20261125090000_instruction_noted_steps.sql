-- ADR 0043 (QA 2026-10-03): a firing that does nothing says so. A NOTED
-- step is what Q tells the person about its own work ("waiting for your
-- working hours", "nothing to do yet"): visible on the work page, never
-- counted as something done, asked or refused. Additive (wider check).

alter table q_runtime.instruction_steps
  drop constraint instruction_steps_status_check,
  add constraint instruction_steps_status_check
    check (status in ('DONE', 'ASKED', 'REFUSED', 'FAILED', 'NOTED'));
