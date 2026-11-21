# Codebase enterprise audit — 21 Nov 2026

**Type:** read-only audit. No code, config or migration was changed. No builds or test suites were run.
**Snapshot:** working tree at `11e40408a`. The web bundle figures come from the `apps/web/.next` build of 14 Nov, the last one on disk.
**Yardstick:**

- root `CLAUDE.md`: apps → packages, no dumping grounds, bounded contexts, typed contracts, RLS, the Context Firewall;
- what a Google, Stripe or Shopify-grade review would expect before calling a codebase production-grade.

**Method:**

- `find`, `grep` and small Node scripts over 6,896 `.ts`/`.tsx` files in `apps/` and `packages/`, excluding `node_modules`, `dist` and `.next`;
- a parse of all 317 migrations;
- `.next/diagnostics/route-bundle-stats.json`.

`graphify-out/` does not exist, so graphify was not used. Every number below can be reproduced with the commands in the appendix.

## Size at a glance

| Measure                                                       | Value                                              |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Source files / lines (excluding tests)                        | 4,402 / 1,172,154                                  |
| Test files / lines / test cases                               | 2,494 / 713,271 / about 19,600 `it(`/`test(` calls |
| Packages (including the 4 apps)                               | 60 workspace packages                              |
| Lines in `apps/` (web 337k, q-api 150k, api 24k, workers 16k) | 527k, which is **45 % of all source**              |
| Source files over 1,000 / 2,000 lines                         | 151 / 34                                           |
| Migrations                                                    | 317 (346 tables)                                   |

## Scorecard

Scores run from 1 (far below the enterprise bar) to 5 (at the bar).

| #   | Dimension                   | Score | Where it stands against the enterprise bar                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------- | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Architecture and boundaries | **2** | **Good:** the package graph is clean. 60 packages, 0 dependency cycles, 0 undeclared `@capital-q/*` imports, 0 deep `src/` or `dist/` imports, and no package imports an app.<br>**Poor:** 45 % of the code lives in apps. There are 151 files over 1k lines, and the largest is 17,401 lines. A Google readability review would reject the god files outright.                                                                                                   |
| 2   | Code health                 | **3** | **Good:** low weak typing in source. 165 `any`, 19 `as unknown as`, 1 non-null assertion, 0 `@ts-ignore`, 94 `eslint-disable` (51 of them are `no-img-element`) and 41 TODO/FIXME.<br>**Poor:** an authorization predicate is copied 23 times. Test code holds 1,427 `as unknown as` casts.                                                                                                                                                                       |
| 3   | Types and contracts         | **4** | **Good:** routes take their paths from `packages/contracts` (`/v1/...`; 57 distinct `/v1/` stems). 50 of 54 `apps/api/src/http/*` files parse with Zod. A problem-details factory exists (`packages/contracts/src/http/problem-factory.ts`). This is close to Stripe-grade discipline.<br>**Missing:** an OpenAPI artifact and contract-diff checks in CI.                                                                                                        |
| 4   | Tests                       | **3** | **Good:** the volume is excellent: 19.6k cases, 139 integration files, 230 pgTAP RLS suites and a 26.7k-line eval package (`packages/q-evals`).<br>**Poor:** 340 test files use real time (`Date.now`, `setTimeout`, `new Date()`) without fake timers, and 75 contain real sleeps. Some test files are gods too (9,459 lines). Integration tests are missing from the fast pre-gate.                                                                             |
| 5   | Security                    | **2** | **Good:** server-side `ActorContext` checks are broad: 389 of 427 route registrations show a guard. The public GateQ routes have a guest throttle. No secret patterns were found in tracked TS. A web baseline of security headers is in place.<br>**Poor:**<br>- **app traffic bypasses RLS**;<br>- no general rate limit;<br>- no CSP and no HSTS;<br>- three exposed credentials are still awaiting rotation;<br>- no offline dependency audit was possible.   |
| 6   | Data and migrations         | **3** | **Good:** forward-only in practice. 0 `DROP TABLE`, 0 `DROP COLUMN` and 0 `DISABLE ROW LEVEL SECURITY` across 317 files. `hosted-migrate-https.mjs` refuses DROP and RLS loosening. 334 of 346 tables have RLS enabled.<br>**Poor:** 195 of 317 migration versions are future-dated, and 47 carry impossible clock times. Point-in-time recovery is off.                                                                                                          |
| 7   | Observability               | **2** | **Good:** a structured logger (`packages/observability`) is used about 420 times in the services.<br>**Poor:** OpenTelemetry is a no-op (`TELEMETRY_EXPORT_ENABLED = false`, SDK not installed). Production says `CAPITAL_Q_ENV=staging` on all 4 services. There is no uptime or error alerting. `pool-watch` alerts go only to logs.                                                                                                                            |
| 8   | Performance                 | **2** | **Poor:**<br>- **First-load JS:** the median route is **2.8 MB** uncompressed and `/discover` is 3.0 MB. All 155 routes are over 1 MB; the 14 Nov build is the latest on disk.<br>- **Client code:** 539 `"use client"` files.<br>- **Polling:** 23 `setInterval` and 37 polling references in web.<br>- **N+1:** about 14 likely N+1 loops (`await` inside `for…of` in repositories).<br>This is far from the `CLAUDE.md` LCP ≤2.5 s target on mid-range phones. |
| 9   | Developer experience and CI | **2** | **Poor:**<br>- The only full gate runs locally, behind one machine lock, and takes about 22 min. GitHub CI is manual only.<br>- The pre-gate skips integration tests, which caused 2 failed gates on 20 Nov.<br>- The onboarding docs contradict each other: `CLAUDE.md` still names Vercel/Render hosting and the $250 budget, and `START-HERE.md` stacks 5 "latest" handoffs.<br>- The handoff files total 4.9k lines.                                          |
| 10  | Reliability                 | **3** | **Good:** idempotency keys appear in 438 source files and the outbox in 161. The pool wedge got a root-cause fix plus a watchdog (`0b5581d3e`). Timeouts now use `SET LOCAL`.<br>**Poor:** q-api's `DATABASE_POOL_MAX` is 3. Statement timeouts were silently not in force through Supavisor until 16 Nov. There are no SLOs and no load tests.                                                                                                                   |

**Overall: 2.6 / 5.** The foundations are better than most start-ups have: contracts, Zod, the outbox, idempotency, pgTAP, and a clean package graph. The structure on top of them is not: god files, domain logic in apps, and bundle weight. The security defence in depth is thinner than the documents claim.

## Largest 20 files (source and test)

|  Lines | File                                                                          |
| -----: | ----------------------------------------------------------------------------- |
| 17,401 | `packages/model-gateway/src/q/index.ts` (190 exports, 91 top-level functions) |
| 12,095 | `packages/q-specialists/src/answer.ts`                                        |
|  9,520 | `apps/q-api/src/main.ts`                                                      |
|  9,459 | `packages/q-specialists/test/answer-turn-reading.test.ts`                     |
|  7,381 | `packages/database/src/generated/database.types.ts` (generated; acceptable)   |
|  7,113 | `packages/q-core/src/ui-text/source.generated.ts` (generated; acceptable)     |
|  6,464 | `apps/q-api/src/voice/onboarding-port.ts`                                     |
|  5,612 | `packages/model-gateway/test/q-answer-tools.test.ts`                          |
|  4,864 | `packages/gateq-intake/test/live-relations-replay.test.ts`                    |
|  4,094 | `packages/model-gateway/test/q-answer-research.test.ts`                       |
|  4,051 | `apps/api/src/main.ts`                                                        |
|  3,850 | `apps/q-api/src/composition/instructions/engine.ts`                           |
|  3,712 | `apps/web/src/features/onboarding-conversation/q-onboarding-workspace.tsx`    |
|  3,631 | `packages/onboarding/src/application/use-cases.ts`                            |
|  3,540 | `packages/model-gateway/src/q/navigation-decision.ts`                         |
|  3,524 | `apps/q-api/src/voice/interview-agent.ts`                                     |
|  3,427 | `apps/q-api/src/composition/rehearsals.ts`                                    |
|  3,347 | `apps/q-api/src/composition/workforce/plan-job.ts`                            |
|  3,233 | `packages/model-gateway/test/navigation-decision.test.ts`                     |
|  3,214 | `apps/web/src/features/voice/provider/duplex-line.ts`                         |

Enterprise norm: a file of more than about 800 lines needs a reason. More than 2,000 lines is a refactoring ticket. Q's whole answer path (`q/index.ts` plus `answer.ts`) is 29.5k lines in two files, so every Q change collides there.

## Lines per package (source / test files), top 15

```
apps/web 336,946/569      apps/q-api 150,412/427      model-gateway 70,785/280
q-core 61,219/183         contracts 49,027/43         q-specialists 38,098/105
q-tools 36,449/80         q-evals 26,719/31           discovery 26,358/56
apps/api 24,217/79        app-actions 21,619/21       gateq-intake 20,368/37
network 17,879/30         evidence 17,382/32          q-research 16,653/37
```

Two packages are under-tested for their size:

- `packages/contracts`: 49k lines and 43 test files;
- `packages/api-client`: 10.8k lines and 5 test files.

## Top 15 findings, ranked

### 1. Application traffic bypasses RLS, so tenant isolation rests on application code alone

**Evidence:**

- `supabase/migrations/20261220190000_history_append_only_guards.sql:4` says: "the Supavisor backends run as postgres, rolbypassrls = true".
- `packages/config/src/database.ts` has the REQUEST and PRIVILEGED_SERVICE access classes, but both reach Postgres as the bypass role.
- 247 of the 334 RLS-enabled tables have **no policy**. They are deny-all to `authenticated`, which protects only against direct PostgREST use.
- Only 8 tables use `FORCE ROW LEVEL SECURITY`.
- The 230 pgTAP suites test policies that production request traffic never passes through.

**Impact:** `CLAUDE.md` says "Enforce server-side _and_ with RLS". Today the RLS half does not apply to the app's own queries. A single missed `tenant_id` filter in any of about 196 inline SQL sites in apps, or in the repositories, leaks data across tenants. A Stripe or Shopify review would call this the top risk.

**Fix:**

1. Create a `cq_request` login role with no BYPASSRLS. Point the REQUEST access class at it.
2. Make every transaction issue `SET LOCAL request.jwt.claims` and the actor id.
3. Write policies for the request-path tables, starting with `core`, `network`, `evidence`, `gateq` and `communication`.
4. Keep PRIVILEGED_SERVICE on the bypass role for workers, with each use named explicitly.
5. Roll out one schema at a time behind pgTAP and integration tests.

**Effort:** 12–15 days, as 4–5 slices.

### 2. No general rate limit, no CSP and no HSTS

**Evidence:**

- `@fastify/rate-limit` and `@fastify/helmet` are in no `apps/*/package.json`.
- Throttling exists only for GateQ guests (`packages/gateq-intake/src/domain/throttle.ts`) and the voice providers.
- `apps/web/next.config.ts:5` says a CSP "arrives with the identity/auth application slice". It has not arrived.
- No `Strict-Transport-Security` header is set anywhere.
- The launch-readiness audit of 20 Nov lists the same gaps.

**Impact:** credential stuffing and scraping are possible. Model-cost abuse is bounded only by per-run caps. XSS has no second wall.

**Fix:**

- Add a per-actor and per-IP limiter at both Fastify apps, Postgres- or memory-backed, with a 429 problem detail.
- Set HSTS at the web origin.
- Ship a nonce-based CSP in report-only mode first.

**Effort:** 3 days.

### 3. Domain logic and SQL live in the apps

**Evidence:**

- 527k lines (45 %) are in `apps/`. `apps/q-api` alone has 150k.
- `apps/q-api/src/main.ts` is 9,520 lines and `apps/api/src/main.ts` is 4,051.
- 49 app files contain about 196 inline SQL template sites, in `apps/api`, `apps/q-api` and `apps/workers`.
- `apps/q-api/src/composition/*` holds the workforce, rehearsals and the instruction engine. These are business capabilities, not composition.

**Impact:** it breaks the `CLAUDE.md` rule "Apps are composition/runtime boundaries, not homes for domain logic". The logic cannot be reused or tested in isolation, and the bounded-context ownership is fiction for q-api.

**Fix:**

1. Freeze new SQL in apps with an eslint rule that bans `sql\`` under `apps/**`, using a baseline file.
2. Then move features out one at a time, for example `composition/workforce` to `packages/q-orchestrator` and `voice/onboarding-port.ts` to `packages/onboarding`.
3. Cover each move with characterization tests first.

**Effort:** 15+ days, ongoing. The freeze is 0.5 day.

### 4. God files on the Q path

**Evidence:**

- `packages/model-gateway/src/q/index.ts` has 17,401 lines and 190 exports.
- `packages/q-specialists/src/answer.ts` has 12,095.
- 151 source files exceed 1,000 lines.

**Impact:** every Q change lands in the same two files, so merge conflicts between parallel lanes are near-certain. Reviews cannot be meaningful. Type-checking is slow: root `tsc` needs `--max-old-space-size=7168`.

**Fix:**

1. Split by responsibility behind the existing `@capital-q/model-gateway/q` entry point, so there is no import churn. The parts are prompt assembly, tool-loop control, research, navigation and answer post-processing.
2. Add an eslint `max-lines` rule (warn above 1,500, error above 3,000) with a baseline.

**Effort:** 8 days for the top 5 files.

### 5. Production cannot be observed

**Evidence:**

- `packages/observability/src/telemetry.ts` has `TELEMETRY_EXPORT_ENABLED = false`, and the OTel SDK is not installed.
- `ACCEPTANCE-MATRIX-2026-11-13.md` records `CAPITAL_Q_ENV=staging` on all 4 production services.
- `audits/2026-11-20-launch-readiness.md` records no uptime or error monitoring.
- The 19 Nov pool wedge lasted 73 min and was found by people, not by an alert.

**Impact:** the time to detect an outage is unbounded, and logs cannot be told apart from staging.

**Fix:**

1. Add a `production-synthetic` value, or make production say `production` and keep the synthetic attestation as a separate flag.
2. Run an external uptime probe on the 4 health endpoints.
3. Add error-rate and `DB_POOL_EXHAUSTED` alerts.
4. Install the OTLP exporter, behind the existing opt-in.

**Effort:** 3 days, plus the owner's choice of vendor.

### 6. Web bundles are 2.8 MB at the median route

**Evidence:**

- `apps/web/.next/diagnostics/route-bundle-stats.json` (14 Nov) shows a median `firstLoadUncompressedJsBytes` of 2,848 KB and a maximum of 3,462 KB.
- `/discover` is 3,009 KB and `/` is 1,516 KB.
- 539 `"use client"` files.
- The two largest chunks are 1.2 MB each.

**Impact:** on a mid-range phone, the LCP ≤2.5 s and INP ≤200 ms targets cannot be met. A Shopify performance budget would fail every route.

**Fix:**

1. Find what is in the 1.2 MB chunks. The likely suspects are voice, Q Dock and the Motion/rehearsal code on every route.
2. Lazy-load the Q Dock and voice.
3. Push leaf components back to server components.
4. Add a CI budget per route that fails above 600 KB.

**Effort:** 5 days.

### 7. The gate is slow, local only, and the pre-gate misses integration tests

**Evidence:**

- `scripts/ci-local.sh` takes about 22 min behind `/tmp/ci-local/heavy.lock`.
- `.github/workflows/ci.yml` runs on `workflow_dispatch` only.
- `scripts/pre-gate.sh` (116 lines) has no integration or pgTAP step.
- There were 2 failed gates on 20 Nov.

**Impact:** about 1 release per 22 min per machine, with no parallel lanes. A failure costs a full rerun. There is no independent record of CI.

**Fix:**

1. Add `vitest related` against `vitest.integration.config.ts` for changed packages to `pre-gate.sh`.
2. Shard the gate: run the database lane and the unit tests in parallel, as GitHub CI already does with 3 shards.
3. Cache the turbo outputs.
4. Longer term, use a self-hosted runner so receipts are not tied to one machine.

**Effort:** 3 days.

### 8. An authorization predicate is copy-pasted 23 times and has diverged

**Evidence:**

- `function ownConversation(actor, plan)` is defined in 23 files under `packages/q-tools/src/tools/*`, for example `record-changes.ts:56`.
- Hashing the bodies gives 5 or more distinct variants. Only 7 copies are identical.

**Impact:** the Context Firewall check differs from tool to tool. A fix to one copy does not reach the others. This is exactly the drift that authorization reviews exist to catch.

**Fix:**

1. Export one `ownsConversation` from `packages/q-firewall` or `packages/q-tools/src/authorize`.
2. Delete the copies.
3. Add a table test per tool covering another user's conversation, the AGENT actor and a missing scope.

**Effort:** 1 day.

### 9. Wall-clock tests

**Evidence:**

- 340 of 2,494 test files call `Date.now()`, `setTimeout`, `new Date()` or `performance.now` without `vi.useFakeTimers` or `setSystemTime`.
- 75 sleep for real (`new Promise(r => setTimeout(...))`).
- 11 files use `retry`.

**Impact:** they fail when the machine is under load, which is the normal state behind the shared heavy lock. They also slow the gate. `CLAUDE.md` calls flaky tests defects.

**Fix:**

1. Add a lint rule for test files that bans real sleeps.
2. Convert the 75 sleepers first, then inject a clock into the code under test.

**Effort:** 5 days.

### 10. Migration versions have stopped meaning time

**Evidence:**

- 195 of 317 versions are dated after today, up to `20261231599900`.
- 47 have impossible clock times, with minutes or seconds above 59.
- The `202612315999xx` space is nearly exhausted.

**Impact:**

- The order is now a hand-managed counter.
- Two lanes picking "the next number" collide.
- Tools that parse the version as a timestamp, such as the Supabase CLI and its diff and squash, may misbehave.

**Fix:**

1. Do not rename applied migrations; they are immutable.
2. From now on, use real UTC timestamps that are strictly greater than the last one, or a documented `2027…` counter.
3. Add a guard test that checks ordering, uniqueness and that new files are not edited after apply.

**Effort:** 1 day.

### 11. Point-in-time recovery is off

**Evidence:** `audits/2026-11-20-launch-readiness.md` records daily backups only, so up to 24 h of data could be lost.

**Impact:** a bad migration or an operator error loses a day of customer data. This is unacceptable at any enterprise bar.

**Fix:**

1. Turn on PITR. It costs money, so it needs the owner's approval.
2. Rehearse one restore into a scratch project and record the RTO and RPO.

**Effort:** 0.5 day of engineering, plus the cost.

### 12. Exposed credentials are still waiting for rotation

**Evidence:** `START-HERE.md`'s credentials table lists the 2026-10-11 Railway token, Kathryn's demo password and the Supabase token as "exposed in chat ... **must be rotated**".

**Impact:** live credentials have been in chat logs for about 6 weeks.

**Fix:**

1. The owner rotates all three.
2. Record the rotation date in `docs/ai-handoff`, without the values.
3. Add a 90-day rotation note.

**Effort:** 0.5 day, owner.

### 13. The instructions contradict themselves

**Evidence:**

- `CLAUDE.md` still states the $250 budget, the 2026-09-28 deadline and "Hosting per ADR 0001 (Vercel ... Render)", then says these are superseded.
- `START-HERE.md` carries 5 stacked "Latest handoff" banners and says to branch from `build/int-rc`, then calls it stale.
- The handoff docs total 4.9k lines (`HANDOFF-LOG.md` alone is 2,321).

**Impact:** every new agent or engineer spends context and judgement deciding which rule is live. Wrong-branch and wrong-host mistakes follow.

**Fix:**

1. Delete the superseded text from `CLAUDE.md`, keeping only a pointer to `LEGACY-RECONCILIATION.md`.
2. Keep one "current" block in `START-HERE.md`.
3. Archive `HANDOFF-LOG` entries older than 14 days.

**Effort:** 1 day.

### 14. Test doubles are cast and do not track the real interfaces

**Evidence:**

- 1,427 `as unknown as` casts in test code, against 19 in source.
- Test god files: 9,459, 5,612, 4,864 and 4,094 lines.

**Impact:** a fake that is cast compiles even when the real port has changed shape. Tests then stay green while production breaks.

**Fix:**

1. Build typed fakes per port in `packages/test-support`, which is only 28 lines today.
2. Ban `as unknown as` in new test code with a baseline.
3. Split the 4 largest test files by behaviour.

**Effort:** 4 days.

### 15. Database pool and query shape

**Evidence:**

- q-api's `DATABASE_POOL_MAX` is 3 (`HANDOFF-LOG.md`, 20 Nov).
- Statement timeouts did not apply through Supavisor until 16 Nov (`packages/database/src/internal/postgres.ts:33-50`).
- About 14 `await`-in-loop sites in repository and Postgres files.
- 23 `setInterval` loops and 37 polling references in web.

**Impact:** any slow Q turn starves the 3 slots, which is the 19 Nov failure mode. Polling multiplies the load with each open tab.

**Fix:**

1. Move q-api to the transaction pooler, with the pool size set from a measured concurrency.
2. Batch the N+1 loops with `= ANY($1)`.
3. Replace polling with the existing SSE stream where one exists.
4. Add a k6 or autocannon smoke test for 20 concurrent Q turns.

**Effort:** 3 days.

**Not assessed:** a dependency vulnerability scan. `pnpm audit` needs network access to the registry, and no offline advisory database is available. Run `pnpm audit --prod` in slice W1-4.

## What already meets the bar (keep it)

- **Package graph:** 0 cycles, 0 undeclared imports, 0 deep imports, and no package depends on an app.
- **Contracts:** typed `/v1` path constants in `packages/contracts`, Zod parsing in 50 of 54 API route files, and a problem-details factory.
- **Side effects:** idempotency keys and the transactional outbox are used widely, in 438 and 161 files.
- **Migrations:** applied with guards (`hosted-migrate-https.mjs`), with no destructive DDL in 317 files.
- **RLS tests:** 230 pgTAP RLS suites with positive, cross-tenant and revoked cases. They become production-relevant once finding 1 is fixed.
- **Type discipline in source:** 0 `@ts-ignore` and 1 non-null assertion in 1.17M lines.
- **Model calls:** they go through the gateway, except for the voice provider (`apps/q-api/src/voice/providers/gpt-live.ts`) and the embedding adapter. Both are adapters, which the rule permits, but the voice provider should move behind `packages/model-gateway`.

## 4-week remediation plan

Rules for every slice:

- each slice fits one worker;
- each slice writes tests **before** any behaviour change;
- no slice touches another slice's files at the same time;
- migrations and authorization slices have one owner.

### Week 1: stop the bleeding (no product behaviour change)

| Slice | Work                                                                                                                                   | Tests first                            | Days |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---: |
| W1-1  | `pre-gate.sh` runs related integration tests and pgTAP for changed migrations; the gate shards its database and unit lanes             | gate dry run on a known-bad commit     |    2 |
| W1-2  | Observability: correct the production env label, external uptime probe, error-rate and pool alerts                                     | alert fire test against staging        |    2 |
| W1-3  | Guardrail lint rules with baselines: `max-lines`, no `sql\`` under `apps/**`, no real sleeps in tests, no new `as unknown as` in tests | the lint rules' own tests              |  1.5 |
| W1-4  | Security quick wins: HSTS, CSP report-only, `pnpm audit --prod` triage; owner rotates the 3 credentials; owner decides on PITR         | header assertions in an e2e smoke test |  1.5 |
| W1-5  | Migration version policy plus a guard test; trim `CLAUDE.md` and `START-HERE.md`                                                       | guard test                             |    1 |

### Week 2: authorization consolidation and rate limits

| Slice | Work                                                                                                                       | Tests first                                                                       | Days |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---: |
| W2-1  | One `ownsConversation` helper; delete the 23 copies                                                                        | per-tool negative table test written against today's behaviour, then the refactor |    1 |
| W2-2  | Rate limiter on api and q-api, with a 429 problem detail and per-actor and per-IP budgets in versioned config              | limiter unit tests plus a route integration test                                  |    3 |
| W2-3  | RLS design: `cq_request` role, claim plumbing in `packages/database/src/transaction.ts`, request-path table inventory; ADR | pgTAP: new role is denied on every table without a policy                         |    2 |

### Week 3: RLS rollout and the first god-file split

| Slice | Work                                                                                                | Tests first                                                                 | Days |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---: |
| W3-1  | Policies plus REQUEST traffic on `cq_request` for `core` and `network` (feature-flagged per schema) | pgTAP positive, cross-tenant and revoked cases; integration run on the flag |    4 |
| W3-2  | Split `packages/model-gateway/src/q/index.ts` into modules behind the same export                   | snapshot or characterization tests on the public exports before the move    |    4 |
| W3-3  | Typed fakes in `packages/test-support`; convert the 75 sleeping tests                               | conversions are test-only                                                   |    3 |

### Week 4: performance and the next splits

| Slice | Work                                                                                                        | Tests first                                                              | Days |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---: |
| W4-1  | RLS for `evidence`, `gateq` and `communication`                                                             | same pgTAP pattern                                                       |    4 |
| W4-2  | Bundle: analyse the 1.2 MB chunks, lazy-load Q Dock and voice, add a per-route budget check                 | Playwright smoke on the 6 heaviest routes before and after; LCP measured |    4 |
| W4-3  | Pool sizing, transaction pooler for q-api, batch the 14 N+1 loops, 20-turn load smoke                       | load smoke baseline first                                                |    3 |
| W4-4  | Split `packages/q-specialists/src/answer.ts`; extract `apps/q-api/src/composition/workforce` into a package | characterization tests                                                   |    4 |

After week 4, the remaining work is:

- the extraction from apps (finding 3);
- the remaining god files;
- an OpenAPI artifact from the contracts, with breaking-change detection.

## Appendix: how the numbers were produced

- **File set:** `find apps packages -name '*.ts' -o -name '*.tsx'`, excluding `node_modules`, `dist` and `.next`. Test files match `/test/`, `.test.` or `.spec.`.
- **Package graph:** a script read each `package.json`'s dependencies, ran a depth-first search for cycles, and compared each file's `@capital-q/*` imports with the declared dependencies.
- **RLS:** a script lower-cased and normalised all 317 migrations, then matched `create table`, `enable row level security`, `force row level security` and `create policy … on`.
- **Routes:** `app|scope.(get|post|…)(` registrations in `apps/api/src` and `apps/q-api/src`. A route counted as guarded when its first 700 characters contained a guard keyword. This is a heuristic: the unguarded hits were reviewed and are the intended public GateQ, webhook, invitation-preview and site-content routes.
- **Bundles:** `apps/web/.next/diagnostics/route-bundle-stats.json`, build of 14 Nov.
- **Not run:** lint, tsc, tests, build, `pnpm audit`.
