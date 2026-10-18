-- R21 (founder live test 2026-09-27 #3) · The screen a question was asked from.
--
-- Q answered "I can't see your screen" while the person was on their
-- profile. Each typed and spoken turn now carries the screen (a closed
-- route name, plus the canonical entities it shows). The run keeps the
-- route and only the entity ids that resolved for the asker when the run
-- was created; an entity that did not resolve is dropped, as if absent.
-- It is an input, never authority: the Context Firewall plans over the
-- entities as subjects exactly like named ones.
--
-- A run-level column, like `viewing`: where the person was is a fact of
-- this turn, and must not carry forward to the next one.
--
-- Additive and nullable; the table's grants and RLS are unchanged.

alter table q_runtime.runs
  add column screen jsonb check (
    screen is null
    or (jsonb_typeof(screen) = 'object'
        and length(screen::text) <= 512
        and screen ? 'route'));

comment on column q_runtime.runs.screen is
  'The screen the question was asked from (QScreenContext): route, plus only the entity ids that resolved for the asker; null when the client sent none. Never a grant.';
