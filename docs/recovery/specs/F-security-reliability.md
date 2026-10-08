# Workstream F: security, data and reliability

Owner: workstream F. Branch `build/rec-f`. Migration band `2026122019xxxx`; pgTAP 895–897.
Sources: `capital-q-audit/{02,10,12,13}-*.md`, `_findings/A.md` (DEF-A1, A2, A4, A9, A14, A15), `_findings/F.md` (F-D1, D2, D4, D5, D6, D7, D8, D10).

## 0. Live facts verified for this spec (read-only aggregates, 2026-10-08)

Run with `node scripts/handoff/live/hosted-read.mjs "<select>"`. No row contents were copied.

| Fact                      | Query shape                                                          | Result                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime role              | `pg_stat_activity ⋈ pg_roles` grouped by `usename, application_name` | 8 `Supavisor` client backends as **`postgres`, `rolbypassrls = true`**, `rolsuper = false`. PostgREST runs as `authenticator` (no bypass). This confirms DEF-A2 / F-R1: the app's DATABASE_URL user bypasses RLS. |
| Dead q.action outbox rows | `events.outbox` grouped by type, `last_error` prefix, attempts       | **666** rows, all `EVENT_SCHEMA_INVALID: UNKNOWN_TYPE`, `published_at null` (prepared 326, rejected 198, approved 71, executed 64, execution_failed 7). Still growing (657 at audit time).                        |
| Append-only guards        | `pg_trigger` on `network.*`, `audit.*`                               | No trigger on `network.relationship_events`, `audit.material_actions`, `audit.security_events`. Other network tables use `private.network_deal_append_only()`.                                                    |
| Checkpoints               | `pg_stat_user_tables` for `q_runtime.checkpoint*`                    | checkpoints 16.7k rows/24 MB, blobs 110k/27 MB, writes 94k/40 MB. Runs: COMPLETED 1523, CANCELLED 1225, FAILED 54, EXPIRED 24, AWAITING_APPROVAL 5.                                                               |
| Ledger                    | `ai_ops.model_usage` count/sum                                       | 13,249 rows, $14.58 total, 516 rows today. A per-day `sum()` is cheap.                                                                                                                                            |

## 1. Research basis

- **Outbox registry.** `packages/eventing/src/publisher/outbox-publisher.ts:171-186` validates each claimed row against the worker registry and records `EVENT_SCHEMA_INVALID` after `maxAttempts`. `apps/workers/src/event-registry.ts:22-37` omits `Q_ACTION_EVENTS` (`packages/q-actions/src/events/index.ts:122`), which q-api writes (`apps/q-api/src/main.ts:374`). Every type is sent to the one pgmq queue `domain-events` (`packages/eventing/src/publisher/pgmq-dispatcher.ts:21`); the worker handler archives types it has no consumer for (`apps/workers/src/events/document-processing-handler.ts:231-239`), so registering the q.action set is safe and makes them flow.
- **RLS and the runtime role.** Supabase docs: the `postgres` role has `BYPASSRLS`; RLS applies to `anon`/`authenticated` (and to non-bypass custom roles). PostgreSQL docs (`SET LOCAL`, `set_config(name, value, true)`): a transaction-scoped GUC works with transaction-mode poolers (Supavisor) because it ends with the transaction, while `SET` (session) would leak across pooled clients.
- **Railway.** Railway's GitHub source has a "Wait for CI" option (`checkSuites` in the IaC): a push deploys only after the commit's GitHub check suites pass. It needs a workflow that runs on that branch. Railway environments (`railway environment new <name>`, or the dashboard's "New Environment", optionally duplicating `production`) give each environment its own variables, services and branch trigger.
- **Health.** Doc 21 §74-77 splits liveness (no dependency checks) from readiness. Railway's `healthcheckPath` gates a deploy's cut-over; it must answer 200 within the timeout. `checkDatabaseHealth` already exists (`packages/database/src/health.ts:15`) and leaks no host or version.
- **Spend.** `ai_ops.model_usage` is the append-only ledger of every attempt (`packages/model-gateway/src/infrastructure/postgres-usage.ts:14-33`); caps exist per request (`gateway.ts:788-796`) and per feature (duplex, q-daily, delegation) but not in aggregate (F-D8).
- **Retention.** LangGraph `PostgresSaver` tables have no timestamp; `thread_id` is the Q run id (`packages/q-orchestrator/src/thread.ts:18`), so a run's terminal status and `completed_at` decide when its checkpoints are dead. `q_runtime.voice_line_turns` rows with `conversation_id null` have no deletion path, and `user_id on delete restrict` blocks erasure (F-D10).

## 2. Current behaviour (path:line)

| Item        | Current                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-01        | `apps/workers/src/event-registry.ts:22-37` has no q-actions; `apps/workers/package.json` has no `@capital-q/q-actions`.                                                                                                                                                                                      |
| CI          | `.github/workflows/ci.yml:8-13` runs on PRs and `main` only. No pgTAP or e2e jobs. `.railway/railway.ts:109-112` `checkSuites: false`, branch `recovery/2026-09-12`.                                                                                                                                         |
| A-02        | `packages/database/src/client.ts:24-41` opens the pool with no role or GUC. 86 policies are `to authenticated` only.                                                                                                                                                                                         |
| A-04        | `apps/q-api/src/app.ts:763-770`, `apps/api/src/app.ts:440-445`: static `{status:"ok"}`.                                                                                                                                                                                                                      |
| F-08        | No aggregate cap in `packages/model-gateway/src/gateway.ts`.                                                                                                                                                                                                                                                 |
| A-09 / F-10 | No pruning anywhere; `20261220150000_q_voice_line_transcripts.sql:22,46-47`.                                                                                                                                                                                                                                 |
| F-04        | `packages/q-specialists/test/answer-turn-reading.test.ts:966-999` missing the two data-room offers and the upload offer.                                                                                                                                                                                     |
| pgTAP       | 010 (capabilities and roles lack `organisation.own` / `organisation_owner` from `20261207150000`), 240 and 591 (founder v4 is current since `20261218100000`), 450 (gateq has 20 tables since the inbox migrations).                                                                                         |
| F-01        | `a2000000-…-000000000022` is used by `20261203090000` (gpt-realtime-mini) and `20261215090000` (gemini-3.1-flash-lite-image); the second insert no-ops. `packages/model-gateway/src/images/config.ts:25` points image usage at the realtime row.                                                             |
| F-02        | `supabase/tests/database/rls/882_document_jobs.test.sql:85-86` asserts the status of id `…022` and passes for the wrong reason.                                                                                                                                                                              |
| F-07        | `packages/observability/src/telemetry.ts:21` `TELEMETRY_EXPORT_ENABLED = false`; no exporter.                                                                                                                                                                                                                |
| Idempotency | `apps/api/src/http/app-actions.ts:180`: a screen-surface action without `http.idempotencyKeyOf` gets `request.id` (fresh per request) as its idempotency key. 96 CONSEQUENTIAL and 32 INSTANT HTTP actions have no `idempotencyKeyOf`, so a client retry is a second execution unless the domain dedupes it. |
| Destructive | `packages/app-actions/src/actions/document-manage.ts:181,230`: action `document.archive` is exposed to Q as tool `delete_document` (archive and delete conflated). `settings.etiquette_guide.remove` (DELETE) is INSTANT.                                                                                    |
| Docs drift  | `packages/config/src/model-providers.ts:116-124` and `packages/model-gateway/src/providers/openai.ts:34-50` say OpenAI is diagnostic only; `20261008130000_ai_ops_openai_primary.sql` made it primary. CLAUDE.md says Vercel/Render; production is Railway for all four services.                            |

## 3. Design

1. **F1 (A-01).** Add `@capital-q/q-actions` to `apps/workers` and `Q_ACTION_EVENTS` to the registry. New test `apps/workers/test/event-registry.test.ts`: (a) every `defineEvent({ name })` in `packages/*/src` is registered (static scan, so a new event cannot be forgotten); (b) the q.action set parses through the registry; (c) the api registry is a subset of the worker registry. Script `scripts/ops/requeue-q-action-outbox.mjs`: dry-run by default, prints aggregates only; `--apply --local` resets `attempt_count`/`last_error` for `q.action.*` rows with `EVENT_SCHEMA_INVALID: UNKNOWN_TYPE` so they publish after the deploy (the consumer archives them); `--archive` marks them published with a `last_error` note instead. Refuses any non-loopback DATABASE_URL unless `--hosted-approved-by=<name>` is passed. Not run against hosted.
2. **F2 (CI).** `ci.yml` push branches: `main`, `recovery/**`, `build/rec-*`. New `db` job: `pnpm exec supabase start` (only db services), `supabase test db`, on the same triggers. New `e2e` job: `workflow_dispatch` only, documented, because it needs a seeded stack and secrets. `.railway/railway.ts`: `checkSuites: true` with the instructions in §6.
3. **F3 (A-02).** ADR `docs/adr/0065-runtime-database-role-and-tenant-isolation.md` (proposal). Compensating controls now:
   - migration `20261220190000_append_only_history_guards.sql`: `before update or delete` triggers on `network.relationship_events`, `audit.material_actions`, `audit.security_events` (errcode `55000`, same shape as `private.network_deal_append_only`). Test cleanup that deleted these rows disables the trigger inside its transaction, the established pattern for `run_events`.
   - pgTAP `895_append_only_history_guards.test.sql`: the owner (bypass role) cannot update or delete; inserts still work; `authenticated` is still denied by grants.
   - `packages/database/test/tenant-predicate-guard.test.ts`: a ratchet over the raw SQL of the riskiest repositories (`apps/q-api/src/composition/{instructions,workforce,work}/store.ts`, `apps/api/src/q-work-port.ts`). Each statement touching a schema-qualified table must carry `tenant_id` or appear in a reviewed baseline; a new unscoped statement fails.
4. **F4 (A-04).** `createApp` in api and q-api takes an optional `readiness` probe. `/health/ready` runs it with a 2 s timeout and returns 503 `{status:"unavailable", checks:{database:"<kind>"}}` on failure; liveness is unchanged. Composition passes `() => checkDatabaseHealth(database.sql)` (one line in each `main.ts`).
5. **F5 (F-08).** `packages/model-gateway/src/policy/spend-cap.ts`: `createDailySpendCap({ capUsd, readSpentTodayUsd, clock, refreshMs })`. The gateway asks it before routing; past the cap the request fails with `failureClass: "BUDGET_EXCEEDED"` (Q failure class `BUDGET`) and a structured log naming `spendCap: "DAILY_AGGREGATE"`. Spend = last ledger read (UTC day) + attempts recorded in-process since. A failed ledger read keeps the last value and logs; with no value ever read it admits (a ledger outage must not take Q down; per-request ceilings still hold). `parseDailySpendCapUsd(env)` reads `CQ_MODEL_DAILY_SPEND_CAP_USD` (unset = no cap; invalid = startup error). Postgres reader in `infrastructure/postgres-daily-spend.ts`. Wired in workers; q-api/api wiring is a lead request.
6. **F6 (A-09, F-10).** `apps/workers/src/retention/` with `pruneRunCheckpoints` (threads of runs terminal for 14+ days, batched by 200 threads, under `pg_try_advisory_xact_lock`) and `pruneOrphanVoiceLineTurns` (rows with no conversation older than 30 days). Hourly ticker in workers main. Migration `20261220191000_voice_line_turns_user_erasure.sql`: `user_id … on delete cascade` so a person's erasure removes their transcript. pgTAP 896.
7. **F7.** Test-only fixes above. F-01: migration `20261220192000_image_model_catalog_id.sql` inserts the image model under a fresh id; `images/config.ts` points at it. F-02: 882 asserts by `model_code`, and 896/897 asserts the realtime row is still realtime.
8. **F8 (F-07).** `packages/observability/src/failure-log.ts`: `logQFailure(logger, { failureClass, … })`, a single structured error line with `qFailureClass` validated against `QFailureClass`, and an optional hook `setFailureSink()`. OTLP export: `TELEMETRY_EXPORT_ENABLED` derived from `OTEL_EXPORTER_OTLP_ENDPOINT` + `CQ_TELEMETRY_EXPORT=otlp`; the SDK dependency is a lead decision (§5), so the code path loads it dynamically and logs once if it is absent.

## 4. Files

Owned: `apps/workers/**`, `.github/workflows/ci.yml`, `packages/model-gateway/src/{gateway.ts,policy/**,providers/openai.ts}`, `packages/observability/src/**`, `packages/database/test/**`, `apps/{api,q-api}/src/app.ts` (health), `supabase/tests/**`, `supabase/migrations/2026122019*`, `docs/adr/0065-*.md`, `docs/recovery/specs/F-*.md`, `scripts/ops/requeue-q-action-outbox.mjs`.
Outside, minimal and listed in the report: `packages/q-specialists/test/answer-turn-reading.test.ts` (test only), `packages/model-gateway/src/images/config.ts` (one id), `packages/model-gateway/src/infrastructure/postgres-daily-spend.ts` (new), `packages/config/src/model-providers.ts` (comment), `.railway/railway.ts` (`checkSuites`), `pnpm-lock.yaml` (workspace link), test cleanups that delete guarded rows (add `disable trigger`), `apps/{api,q-api}/src/main.ts` (one readiness line each, if the lead agrees).

## 5. Requests to the lead

- Wire `readiness` and `spendCap` in `apps/q-api/src/main.ts` and `apps/api/src/main.ts` (snippets in the report).
- C: `apps/api/src/http/app-actions.ts:180` should honour a validated `Idempotency-Key` header before `request.id`, and the web should send one per user intent; rename tool `delete_document` to `archive_document` (archive ≠ delete); decide whether `settings.etiquette_guide.remove` is INSTANT by design.
- Decide the OTLP SDK dependency (`@opentelemetry/sdk-node` + `exporter-trace-otlp-http`) and a backend (free: Grafana Cloud free tier, or a self-hosted collector). No paid service without the founder.
- CLAUDE.md hosting facts (proposal only, §7).

## 6. Railway gating and staging (instructions for the founder)

- **Gating:** after `ci.yml` runs on `recovery/2026-09-12` and is green, set `checkSuites: true` (done in IaC) and apply, or in the dashboard: each service → Settings → Source → "Wait for CI". A red CI then holds the deploy; Railway shows "Waiting for CI".
- **Staging:** Railway supports it. Project `Q` → Environments → New Environment `staging` (duplicate `production`), set its trigger branch to `recovery/2026-09-12-8y2j4w`, and give it a **separate database** (a second Supabase project or a Supabase branch). Never point staging at the production DATABASE_URL. Copy variables with fresh secrets, then set `CAPITAL_Q_ENV=staging`. Cost: the four services' usage again.

## 7. Proposed CLAUDE.md change (not edited)

"Hosting per ADR 0001 (Vercel for web; Render for api, q-api, workers)" → "Hosting: Railway for all four deployables (web, api, q-api, workers), project `Q`, EU West; see `.railway/railway.ts` and ADR 0014. ADR 0001's Vercel/Render split is superseded."

## 8. Tests

`apps/workers/test/{event-registry,retention}.test.ts`; `packages/model-gateway/test/spend-cap.test.ts`; `apps/q-api/test/health-ready.test.ts` and api equivalent; `packages/database/test/tenant-predicate-guard.test.ts`; `packages/observability/test/failure-log.test.ts`; pgTAP 895 (append-only), 896 (voice erasure cascade), 897 (image model id); fixed 010, 240, 450, 591, 882.

## 9. Risks

- The append-only triggers break any undiscovered code path that updates or deletes those rows. Mitigation: a repo-wide grep found only test and dev cleanups; they now disable the trigger in-transaction.
- Requeueing 666 old events publishes stale events; consumers archive unknown types and q.action consumers re-read under their own authority (REPLAY_SAFE).
- `checkSuites: true` blocks every deploy while CI is red on the production branch.
- Checkpoint pruning removes the ability to inspect old graph state; only terminal runs older than 14 days.

## 10. Acceptance (TRACKING F1–F8, SPEC §5 scenario H "duplicate event")

Status at handover (2026-10-08). The grades are SPEC §5's.

- [x] **F1. VERIFIED LOCALLY.** Registry and scan test. Requeue script: dry run, plus `--requeue` against a seeded local dead row.
- [x] **F2. PARTIAL.**
  - The CI triggers and the pgTAP job have run on GitHub: the pgTAP job passed on a fresh database.
  - The quality job fails at the format check on 174 pre-existing lead-owned files.
  - The e2e job is documented but has not run.
  - `checkSuites` is set in the IaC and needs the founder to apply it.
  - Staging: not available at $0 (`docs/recovery/staging.md`).
- [x] **F3. VERIFIED LOCALLY.**
  - Role verified on hosted.
  - ADR 0065 proposed.
  - Guards for UPDATE and TRUNCATE (DELETE comes in step 2).
  - pgTAP 895 and the ratchet.
- [x] **F4. VERIFIED LOCALLY (unit).** Wiring in `main.ts` is a lead request.
- [x] **F5. VERIFIED LOCALLY (unit; reader run against the local DB).** Wired in workers. q-api and api are a lead request.
- [x] **F6. VERIFIED LOCALLY.** The SQL was run, then rolled back, against the local DB. pgTAP 896.
- [x] **F7. VERIFIED LOCALLY.** pgTAP 897 plus the fixed suites; CI pgTAP is green.
- [x] **F8. IMPLEMENTED.** The exporter needs the SDK dependency, which is the lead's decision.
- [x] **Idempotency, destructive actions and docs drift.**
  - Duplicate-delivery test.
  - App-action key gap and destructive findings sent to C (§5).
  - OpenAI comments fixed.
  - CLAUDE.md change proposed (§7).
  - F-03 defence in depth in the OpenAI adapter. B's fix is still pending.
