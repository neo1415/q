-- REHEARSE audit (2026-10-01): how hard the person asked to be pushed in a
-- rehearsal (GENTLE, REALISTIC, TOUGH). Additive; existing rows are
-- REALISTIC, which is how they were played.
alter table q_runtime.rehearsals
  add column difficulty text not null default 'REALISTIC'
    check (difficulty in ('GENTLE', 'REALISTIC', 'TOUGH'));
