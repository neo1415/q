# Runbook: retry q-api on the transaction pooler

Decision 101 lets the lead move q-api to whichever connection mode works best, provided the change goes through the gate, is verified live and keeps the previous settings as the rollback point. The first attempt (16 Nov) hung a live run and was rolled back. See `BASELINE-LEDGER-2026-11-12.md`, "Transaction pooler trial on q-api: rolled back".

## What the offline proof found (17 Nov)

Harness: `bash scripts/heavy.sh bash scripts/db/pooler-proof/run.sh`. It runs a separate local Supabase project with Supavisor in transaction mode, using the CLI's own Supavisor image, so it is not PgBouncer. The pool is 4 server connections. LISTEN runs on Supavisor's session port.

- **Cause of the hang.** postgres.js writes a second query onto a connection whose first query has not answered yet whenever no connection is free, even at `max_pipeline: 1`. Supavisor releases the server connection at the first query's ReadyForQuery and never answers the second, so the await hangs with the server idle. This is reproduced deterministically: raw postgres.js with `max_pipeline: 1` hangs on the second read+write pair, while direct Postgres answers all of them. Before the fix, the answer-seam suite hung through the pooler (4 of 5 tests timed out, and the pool wedged).
  - `max_pipeline: 0` is not a fix: BEGIN then never reserves its connection.
- **Fix.** `packages/database/src/round-trips.ts` adds a connection gate in `transaction_pooler` mode only. The request and privileged clients never hand the driver more statements and transactions than `DATABASE_POOL_MAX`:
  - a statement outside a transaction holds one slot until it settles;
  - a transaction holds one slot from BEGIN to COMMIT.
  - The wait for a slot is bounded by the client deadline (57014).
- **Result with the fix: PASS.**
  - 200 concurrent queries finished in about 0.9 s, the slowest about 0.94 s.
  - `show statement_timeout` inside a transaction returns the set_config value.
  - NOTIFY sent through the pooler reaches the session LISTEN.
  - 12 concurrent runs reach a terminal state, half of them paused and resumed by a second process with checkpoints on the pooler.
  - A `pg_sleep` inside a transaction gets 57014 from the server at the limit. In a run, it fails the run cleanly in about 3.1 s.
  - An autocommit `pg_sleep` ends at the client deadline. The cancel does reach the backend through Supavisor, and the pool recovers.
  - 18 integration suites pass with every app client on the pooler and files in parallel: runs, orchestrator, answer seam, approval, firewall resume, checkpoints, conversation states, memory, the model ledger, outbox, q-runs, q-events and work wake.
- **Differences that remain by design.** The harness skips two direct-only assertions:
  - Supavisor drops startup parameters. An autocommit statement has no server-side `statement_timeout` (it reads 0 locally). Its bound is the client deadline, which is the budget plus 2 s, followed by a cancel.
  - A transaction sends one more statement (the set_config).
- **Untested locally.** Hosted latency, the hosted tier's pool of 15 shared across services, and a real model provider.

## Preconditions (all of them)

1. The commit that contains the gate has passed the local gate (`ci-local PASS`) and is deployed to q-api on the **current** session pooler settings, with a smoke turn verified. Change the code first; change the variables afterwards, in a separate step.
2. `bash scripts/heavy.sh bash scripts/db/pooler-proof/run.sh` prints `pooler-proof: PASS` on that commit.
3. The hosted role's own limit is known. Run `node scripts/handoff/live/hosted-read.mjs "select rolname, rolconfig from pg_roles where rolname = current_user"` and record whether `statement_timeout` is set. Unset means autocommit statements rely on the client deadline only, which was proven locally.
4. Pool arithmetic is checked: the Supavisor pool on this tier has 15 server connections, shared by all services. In transaction mode, q-api's `DATABASE_POOL_MAX` client connections share them only while a transaction or statement is in flight. LISTEN takes one session-mode connection per replica. Keep `DATABASE_POOL_MAX` at or below 10.
5. A quiet window, and the lead watching. No other deploy is in flight.

## Variable changes (q-api only; names only)

Before editing anything, save the current values to a 0600 scratch file, as on 16 Nov. That file is the rollback.

| Variable                   | Change                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Change the port only, from 5432 to 6543. Edit it in place without printing it.                                                                                                              |
| `DATABASE_CONNECTION_MODE` | `session_pooler` → `transaction_pooler`                                                                                                                                                     |
| `DATABASE_POOL_MAX`        | 3 → 6 for the first hour, then 10 if the watch list is clean. The gate size follows it.                                                                                                     |
| `DATABASE_LISTEN_URL`      | Leave it unset. It is derived as the same URL on 5432, in session mode. Set it only if the derived URL is wrong.                                                                            |
| Everything else            | Unchanged. In particular, `DATABASE_STATEMENT_TIMEOUT_MS` stays at the 10 s request budget. Workers and api do not change: their LISTEN and privileged clients were not part of this proof. |

The checkpoint store reads the same `DATABASE_URL`, so it moves with q-api. It uses node-postgres, which does not pipeline. In the proof, checkpoints went through the pooler.

## Watch list (first 30 minutes, then hourly for a day)

- **Stalled runs.** Interactive runs that started but have produced no event for 60 s:
  `select r.id, r.status, max(e.occurred_at) from q_runtime.runs r join q_runtime.run_events e on e.run_id = r.id where r.started_at > now() - interval '1 hour' and r.completed_at is null group by 1, 2 having max(e.occurred_at) < now() - interval '60 seconds'`
  Expect none. The 90 s run progress deadline should fail any such run as RUN_EXPIRED.
- **Gaps in model_usage.** Answered runs that have no ledger row:
  `select r.id from q_runtime.runs r where r.completed_at > now() - interval '1 hour' and r.status = 'COMPLETED' and not exists (select 1 from ai_ops.model_usage u where u.q_run_id = r.id)`
  Also compare the hourly count of `model_usage` rows with the same hour the day before.
- **57014 and deadlines.**
  - Search the q-api logs for `TIMEOUT`, `57014` and `client deadline` (`scripts/handoff/live/railway/qlogs.mjs <sha> "57014|TIMEOUT|client deadline" ...`).
  - A few per hour is the baseline. A burst, or any during a smoke turn, means stop and roll back.
- **Pool waits.**
  - `select application_name, state, count(*) from pg_stat_activity group by 1, 2`: Supavisor backends should be mostly `idle`, with none `idle in transaction` for more than 1 s.
  - Watch p95 latency for POST /runs and workforce/overview. On 16 Nov they took 4.7 s and 4.2 s; there should be no regression from the session-pooler baseline.
- **Smoke.** Run one live Q turn at once, then one every 10 minutes for the first half hour. Each must complete, and no stage may be silent for more than 10 s.

Stop and roll back on any of these: a stalled run, a smoke turn that does not complete, a burst of 57014, or a latency regression.

## Rollback

1. Restore `DATABASE_URL` (port 5432), `DATABASE_CONNECTION_MODE=session_pooler` and `DATABASE_POOL_MAX=3` from the scratch file. Do not print any of them.
2. Redeploy q-api (same commit) and wait for SUCCESS.
3. Run a smoke turn. It must complete; on 16 Nov the comparable turn took 11.4 s.
4. Recover any run left hung by the attempt: the run progress deadline or the orphan sweep closes it as FAILED. Confirm with the stalled-runs query.
5. Record the attempt, its times and its evidence in `BASELINE-LEDGER` / `HANDOFF-LOG`.
