# D: Work and agent autonomy (RECOVERY-2026-10, workstream D)

Mission: agents that genuinely execute, persist and report honestly. TRACKING rows D1-D6. Audit defects D-01 … D-15 (`capital-q-audit/_findings/D.md`, `07-WORK-AND-AGENTS.md`). Branch `build/rec-d`, migration band `2026122018xxxx`, pgTAP 892-894.

## 1. Research (sources)

- **Durable jobs.** Postgres `SELECT … FOR UPDATE SKIP LOCKED` claim with a lease column (`locked_until`), a heartbeat that extends the lease while the worker lives, and reclaim of rows whose lease lapsed. This is the core of graphile-worker (`graphile_worker.get_job`, `locked_at` + 4 h reclaim) and pg-boss (`expireInSeconds`, `heartbeatSeconds` in v10+). PostgreSQL docs, "The Locking Clause" (`SKIP LOCKED` "is not suitable for general purpose work, but can be used to avoid lock contention with multiple consumers accessing a queue-like table"). Decision: **no library**. The repo already claims instruction firings this way (`apps/q-api/src/composition/instructions/store.ts:345-360`) and the outbox in `packages/eventing`; one table plus three statements is cheaper than a new dependency and its schema.
- **Agent workforce** (`origin/build/research:docs/research/2026-10-06/agent-workforce.md`): orchestrator-workers plus evaluator-optimizer; roles are config not code; "durable runs: state checkpointed in Postgres so a job survives restarts; resume by job id; idempotent steps" (§2 rule 7); "honest status: waiting on a third party shows that, not a spinner" (§5.8); no internal agent names to the person.
- **Approvals.** CLAUDE.md: Prepare → Recommend → Human Approval → Execute unless explicit scoped delegation. Lindy's per-integration "Always allow / Require approval" is the shape of delegation (research note §1).

## 2. Current behaviour (audit, re-verified at `fe5579c3`; no code changes between `520bd123` and it in these paths)

| Defect                                    | Where                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-02 roster, prompt and runner disagree   | `packages/q-core/src/prompts/tasks/workforce.v1.ts:355` ("written by WRITER and graded by REVIEWER; plan them as steps"); `packages/q-orchestrator/src/workforce/plan.ts:66` (DRAFT_ROLES kept with no tool); `job-runner.ts:164-166` (no executor → HELD, dependants SKIPPED); `apps/q-api/src/composition/workforce/jobs.ts:333-338` (4 executors; OUTREACH is the watcher). Repro: `capital-q-audit/evidence/agents/repro-writer-step.md`. |
| D-01 lapsed card parks a conversation     | TTL `packages/q-actions/src/ports.ts:300`; lazy expiry only on decide `service.ts:1309`; `instructions/store.ts:715-726,762-776` read action status, never `expires_at`; engine holds and tells the planner "plan none of these again" `engine.ts:2151-2160`, removes from replyWaiting `engine.ts:2065-2070`.                                                                                                                                |
| D-08 jobs not resumable                   | `workforce/job-actions.ts:305-325` `void jobs.run(...)`.                                                                                                                                                                                                                                                                                                                                                                                      |
| D-03 near miss recorded HELD while carded | `workforce/review.ts:370-378,403-411`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-04 invented "nothing needs a reply"     | `engine.ts:2811-2824`; cap `engine.ts:1894`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-05 planner failure costs a cadence      | `engine.ts:2170,2272`; claim moves `next_fire_at` first `store.ts:345-360`; `triggers.ts:44-70` no retry.                                                                                                                                                                                                                                                                                                                                     |
| D-06 errand false success                 | `errands.ts:1416-1436`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-07 Q sends not marked                   | `packages/app-actions/src/actions/chat.ts:70-76`; `communication/src/service.ts:171`.                                                                                                                                                                                                                                                                                                                                                         |
| D-09 held job replies silent; empty brief | `jobs.ts:265-289`; `main.ts:1464` `brief: ""`.                                                                                                                                                                                                                                                                                                                                                                                                |
| D-11 endless Working                      | `jobs.ts:625-641` tracker sets RUNNING only.                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-13/D-15 Work page                       | `decision-queue.tsx:224-228,441-444`; `decisions.ts:285-290`.                                                                                                                                                                                                                                                                                                                                                                                 |
| D-14 redraft count                        | filed `maxRedrafts: 2` (`jobs.ts:446,594,636`), loop allows 1 (`review-loop.ts:45-50`).                                                                                                                                                                                                                                                                                                                                                       |

## 3. Design

### 3.1 Executor registry (D1, D-02)

- New `packages/q-orchestrator/src/workforce/executors.ts`: `WORKFORCE_EXECUTORS: Partial<Record<QAgentRole, QAgentExecutor>>` (lead contract types) declares what this deployment can run: CONVERSATION, OUTREACH, SCHEDULING, DISCOVERY and RESEARCH (each `QAgentExecutorSchema`-valid; tools exist in the Q tool/app-action registry). DOCUMENTS and DILIGENCE are **not registered**, with the blocker written beside them (no document-generation service whose output is a durable, checkable artifact; DILIGENCE has no data-room request executor). `registeredRoles()`, `isPlannableRole()`.
- WRITER and REVIEWER are not plan roles: writing and reviewing run inside CONVERSATION/OUTREACH (`review.review` per draft). AD_HOC removed from planning (no QAgentRole).
- Persistence keeps the stored role vocabulary (`WORKFORCE_AGENT_ROLES` in contracts, lead-owned; DB check in `20261207090000`). `storedRole(QAgentRole)`: SCHEDULING→SCHEDULER, DISCOVERY→MANDATE_WATCHER; others identical. Request to lead: add the QAgentRole names to `WORKFORCE_AGENT_ROLES` later and drop the map.
- `boundPlan` refuses `NO_EXECUTOR` (role without registered executor, incl. WRITER/REVIEWER/AD_HOC) and `UNKNOWN_ROLE`. **A plan with any refused step is refused whole before approval** (`validatePlan`), so a partial plan is never offered. The job board returns `NOT_PLANNED` with the reasons logged.
- Prompt `JOB_PLAN` (B's path; minimal edit, listed): roster is built only from registered executors; the WRITER/REVIEWER rule becomes "messages are written and checked inside CONVERSATION and OUTREACH; never plan writing or reviewing as a step"; `PLAN_AGENT_ROLES` = QAgentRole minus LEAD.
- RESEARCH executor: calls the composed `PublicWebResearchService` through a port (`research(owner, query)`), returns a RESEARCH_NOTE persisted as the step's result (queue row `results` jsonb, sources as URLs + titles, `truthClass: UNKNOWN`). Registered only when research is composed (no provider → not registered → plan refused, honestly).
- Old approved payloads (WRITER/REVIEWER steps) still run: `plannedFrom` drops draft-only steps and rewires dependants.

### 3.2 Durable jobs (D3, D-08)

- Migration `20261220180000_agent_work_queue.sql`: `q_runtime.agent_work_queue(job_id pk → workforce_jobs, tenant_id, user_id, state text check in QWorkState, plan jsonb, trace jsonb, attempts, max_attempts, locked_by, locked_until, heartbeat_at, last_error, results jsonb, created_at, updated_at, finished_at)`; RLS forced, owner select only, server writes; terminal states immutable by trigger. Named outside `workforce_%` so pgTAP 790's table count stays true.
- `apps/q-api/src/composition/workforce/queue.ts`: `enqueue` (idempotent on job id), `claim(n, workerId, leaseMs)` = `update … where job_id in (select … where state in ('QUEUED','RUNNING','RECOVERING') and (locked_until is null or locked_until < now()) and attempts < max_attempts order by created_at for update skip locked limit n)`, `heartbeat`, `finish(state)`, `failExhausted()`. A reclaimed lease shows `RECOVERING` until the step loop starts again.
- `runner.ts`: a pass claims, rebuilds the actor, runs the job via `jobs.run(... resume)`, heartbeats every lease/3, finishes COMPLETED / BLOCKED / NEEDS_DECISION / FAILED. Resume: `runJob` asks the recorder for a step's prior DONE result and skips it; a step left RUNNING by a crash is ended FAILED "Interrupted by a restart" and run again (every side effect is idempotent by key: `wf:<job>:reply:<message>`).
- Approval execute enqueues instead of `void jobs.run`; the q-api interval (30 s) and a kick after enqueue run passes. Voice/browser need not stay connected.
- Trace: `trace` holds `QTraceContext` ids (conversation, run, turn when known) so a Work task is traceable to its originating conversation.

### 3.3 Lapsed approvals (D2, D-01)

- `q-actions`: `expireLapsed({limit})` sweep: PENDING approvals past `expires_at` → EXPIRED with their action, per row in its own short transaction (lock, re-check, `expire`). Repository `listLapsed`. Run every 60 s with the instruction sweep.
- Instruction store `awaitingAnswer`/`waitingCards` also require the open approval `expires_at > now()` (belt and braces if the sweep lags). New `lapsedCards(instructionId)`: ASKED steps whose action EXPIRED.
- Engine: a lapsed card is **not** "already asked": the conversation returns to replyWaiting and the planner may redraft; a NOTED `CARD_LAPSED` step plus notice once per action. A card waiting more than `ESCALATE_AFTER_HOURS = 4` raises a `REPLY_WAITING` notice once per card ("Your yes is still needed …, it lapses at …").
- Delegation decision (documented here and in code): a near-miss draft (below the bar but passing every integrity rule) **stays a card** by default. It may send only when the instruction's delegation explicitly allows near misses — no such scope exists in the delegation contract today, so near misses always card. No change in authority.

### 3.4 Honest states (D4)

- D-03: near miss records `OFFERED` linked to the card's `qActionId` (not HELD); the HELD row disappears from Work because the draft's outcome is OFFERED; no "Send as is" while a card is pending.
- D-04: the quiet note says "N not read" when any reachable thread was not read.
- D-05: PLANNER_UNAVAILABLE or a thrown firing defers the next firing by 10 min (not the cadence) and records a visible NOTED step.
- D-06: errand records success only when `post` returned true; otherwise `seenUntil` stays, the person is told once, the next pass retries with the same idempotency key.
- D-09: held job drafts notify the person; the writer gets the step goal as its brief; `theirLatest` passed for thread consistency; a step that held any draft ends `HELD`, not DONE.
- D-11: INSTRUCTION/DELEGATED_WORK tracker ends the lead run and sets the job DONE (or HELD while cards wait) after each firing.
- D-14: jobs filed with `maxRedrafts` equal to the loop's real count.

### 3.5 D-07 sent-by-Q (C's package, minimal)

`AppActionContext` gains optional `qActionId`/`qDelegationId`; `chat.message.send` forwards them. Approved cards pass the action id; instruction AUTO sends pass the delegation (or instruction) id; workforce jobs pass the job id.

### 3.6 Work page (D6, D-13, D-15)

- D-15: `app.chat.message.send` renders as a message card (quote + verbs), like `chat.message.send`.
- D-13: an instruction's "N things need your yes" notice is not counted on top of the cards it summarises; a near miss is one row.
- Persisted state: the workforce DTO already returns jobs and runs; the Work page shows each job's `QWorkState` from the queue (RUNNING / RECOVERING / FAILED with why / COMPLETED), "stop this job" (CANCELLED via queue), and "what Q finished while you were away". Route: existing `/v1/q/workforce/jobs` — fields added need a contract change (request to lead) — until then state is derived server-side into existing fields.

## 4. Files

Owned: `packages/q-orchestrator/src/workforce/**`, `apps/q-api/src/composition/{workforce,instructions,errands,work}/**` (errands.ts is `composition/errands.ts`, listed in the brief), `packages/q-actions/**`, `apps/web/src/features/work/**`, tests beside them, `supabase/migrations/2026122018*`, `supabase/tests/database/rls/892_*`.
Outside, minimal and listed: `packages/q-core/src/prompts/{tasks/workforce.v1.ts,schemas/workforce.ts}` (B), `packages/app-actions/src/{define.ts,actions/chat.ts}` (C), `apps/q-api/src/main.ts` (wiring), `apps/q-api/src/composition/app-actions.ts` (pass qActionId).

## 5. Contracts needed from the lead

- `WORKFORCE_AGENT_ROLES` to accept QAgentRole names (SCHEDULING, DISCOVERY, DILIGENCE); `WorkforceJobDto` gain `workState: QWorkState` and `trace`.
- Export of `QAgentExecutor` types already exists.

## 6. Tests

- Orchestrator: registry validity (every executor parses `QAgentExecutorSchema`), plan refusal NO_EXECUTOR for WRITER/REVIEWER, whole-plan refusal, resume skips DONE steps; repro scenario now refused before approval.
- q-api: 21-hour scenario (card at T, firing at T+21h escalates with REPLY_WAITING once; at T+25h after sweep the card is lapsed, conversation re-enters replyWaiting, no "plan none of these again"); planner failure defers; quiet note "not read"; errand failed send; near miss OFFERED; durable runner (claim, heartbeat, crash → reclaim → resume → COMPLETED; exhausted → FAILED).
- q-actions: `expireLapsed`.
- pgTAP 892: queue shape, RLS forced, owner-only select, cross-tenant negative, no client writes, terminal immutability, SKIP LOCKED claim.
- Web: message card for `app.chat.message.send`; count.

## 7. Risks

- Resume re-runs a step whose side effects were half done; mitigated by per-item idempotency keys. A model call may be repaid.
- `expireLapsed` runs as the service role across tenants; it only moves PENDING→EXPIRED, which the decide path already does lazily.
- The role map is a temporary seam until the contract is widened.

## 8. Acceptance (SPEC §5 / TRACKING)

- [ ] D1: WRITER/REVIEWER/unknown plans refused before approval; registered executors only; RESEARCH real or not registered; DOCUMENTS blocked with reason. (Scenario D)
- [ ] D2: sweep expires lapsed approvals; 21-hour test; escalation notice; near-miss policy documented. (Scenario H: expired approval)
- [ ] D3: leased queue, resume after restart, terminal QWorkState; pgTAP 892. (Scenario H: worker restart)
- [ ] D4: D-03, D-04, D-05, D-06, D-09, D-11, D-14 each with a test. (Scenario H: agent failure)
- [ ] D5: viaQ on every Q send path.
- [ ] D6: message cards and count; persisted state on the Work page.
