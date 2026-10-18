-- RECOVERY-2026-10 (G-D8) · Room for the page manifest on a run's screen.
--
-- `runs.screen` was bounded at 512 characters when it held a route and a
-- few ids (20261015090000). It now also keeps the page's manifest
-- (sections, dialogs and, since the recovery, up to 48 controls), which
-- the orchestrator reads back to plan. On a busy page the insert failed
-- the check and every Q turn from that page answered 500.
--
-- Fix forward: the same shape check with a 64 KiB bound. The writer
-- (create-run screenKept) drops the manifest past 32 KiB of compact JSON,
-- so a turn is never refused for the size of the page it was asked from;
-- the check is twice that because jsonb's text form adds a space after
-- every colon and comma.
-- Additive; grants and RLS unchanged.

alter table q_runtime.runs drop constraint if exists runs_screen_check;

alter table q_runtime.runs
  add constraint runs_screen_check check (
    screen is null
    or (jsonb_typeof(screen) = 'object'
        and length(screen::text) <= 65536
        and screen ? 'route'));
