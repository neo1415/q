-- RECOVERY G-D24 (workstream F): an in-flight Q run says which engine is
-- still holding it.
--
-- The orphan sweep could only judge a run by its last durable event, and a
-- live run can be quiet for minutes (a long model call writes nothing until
-- it returns). So it waited 15 minutes of silence before deciding a run had
-- no engine, and swept every 5 minutes: a run caught by a q-api restart or
-- deploy sat in SYNTHESIS for up to 20 minutes, and the person's turn hung.
--
-- Now the process orchestrating a run touches engine_heartbeat_at every
-- 15 seconds for as long as it holds the run, whether or not the run writes
-- events. A run whose heartbeat stopped for a minute has no engine
-- anywhere, and is failed as RUN_EXPIRED ("That one didn't finish. Ask
-- again and I'll start it fresh."). A run with no heartbeat at all (held by
-- a process from before this change, during the deploy that ships it)
-- keeps the old 15-minute rule, so the rollout cannot kill a live run.

alter table q_runtime.runs
  add column engine_heartbeat_at timestamptz;

comment on column q_runtime.runs.engine_heartbeat_at is
  'Last time the process orchestrating this run said it still holds it (every 15 s). Null for a run no heartbeating engine has held. Read by the orphan sweep (G-D24).';
