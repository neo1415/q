# 07 — Work page and agent system

Investigator D · read-only forensic audit · repo `/home/user/q`, branch `recovery/2026-09-12-8y2j4w`, HEAD `520bd123` · written 2026-10-08.

Evidence excerpts are in `evidence/agents/*.md` (original line numbers). Diagrams: `diagrams/agent-task-execution.md`, `diagrams/work-page-state.md`. Defect ids (D-xx) are listed in `_findings/D.md`.

Classification key: IMPLEMENTED / PARTIAL / CONFIGURED-UNUSED / MOCKED / BROKEN / UNTESTED / PLANNED.

---

## 0. Summary

Capital Q runs **four separate "Q works for you" engines**. Each has its own store, its own trigger and its own way of failing:

| Engine                                   | What it is                                                                                                                                     | Store                                                                                                                                                              | Trigger                                                                                        | Main file                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Standing instructions** (ADR 0043)     | A goal plus an approved grant. A model plans, code validates every step, and each step runs AUTO, becomes a card (ASK), is refused or is held. | `q_runtime.standing_instructions`, `instruction_grants`, `instruction_steps`, `instruction_delegations`, `communication.notifications`                             | 60 s sweep plus `cadence_minutes` (default 240), approval, relationship or chat wake           | `apps/q-api/src/composition/instructions/engine.ts`                                       |
| **Workforce jobs** (founder brief J1–J9) | `propose_q_job`: the lead Q plans steps for agent roles, the person approves the plan, and the plan runs agent by agent                        | `q_runtime.workforce_jobs`, `workforce_agent_runs`, `workforce_drafts`, `workforce_grades`, `workforce_draft_outcomes`, `workforce_handoffs`, `workforce_feedback` | Approval of `q.workforce.job.start`, then fire-and-forget                                      | `apps/q-api/src/composition/workforce/jobs.ts`, `packages/q-orchestrator/src/workforce/*` |
| **Errands** (2026-09-29)                 | `q.errand.start`: express interest; when they accept, chat from the brief, book a call, notify                                                 | `q_runtime` errands tables                                                                                                                                         | `errands.tick()` per minute (gated by the kill switch `q.autonomy.errands`), relationship wake | `apps/q-api/src/composition/errands.ts`                                                   |
| **Delegated work / q-work** (ADR 0030)   | Outreach and stand-in run as LangGraph graphs (`lane`, `outreach`, `stand-in`) with Postgres checkpoints                                       | `q_runtime` work/delegation/lane tables, plus the checkpoint store                                                                                                 | `workRuntime.tick()` every 60 s, wake listener                                                 | `apps/q-api/src/composition/work/runtime.ts`, `packages/q-orchestrator/src/work/*`        |

All four engines share the **writer → reviewer loop** (`OutwardReview`, `apps/q-api/src/composition/workforce/review.ts`), which runs over `writeWithReview` in `packages/q-orchestrator/src/workforce/review-loop.ts`. The loop passes a draft at threshold 75 and allows `REVIEW_ROUNDS_MAX` 2 rounds. Each engine records into the same workforce tables, and the Work page "Team map" draws from those tables.

Overall verdict. The standing-instruction engine is real: it calls models, validates steps, executes actions under idempotency keys, creates approval cards and sends notices. It is heavily defended, and the result is that a counterpart can easily go unanswered. The defensive layers are ten or more refusal codes, a consider step, thread consistency, a reviewer at 75, near-miss cards only, an environment autonomy switch, delegation, working hours and caps. When everything refuses, the person gets one notice. When an approval card simply waits, nothing escalates. After 24 h the card disappears from Needs you, but the engine still treats the conversation as "already asked" (D-01).

Workforce jobs are only **PARTIAL**. Four of the ten roles have executors. A plan that follows the lead-Q prompt (a WRITER step, then a REVIEWER step) blocks every dependent step (D-02, reproduced). Jobs are not resumable (D-08).

---

## 1. Implementations inventory

### 1.1 Standing instructions — IMPLEMENTED (with defects)

- **Tables.** Defined in `supabase/migrations/20261121090000_standing_instructions.sql`, `20261122090000_instruction_conversation.sql`, `20261123090000_instruction_triggers.sql`, `20261124090000_instruction_digest.sql`, `20261125090000_instruction_noted_steps.sql` and `20261217090000_instruction_delegations.sql`.
  - `cadence_minutes integer not null default 240 check (cadence_minutes between 30 and 10080)` (`20261123090000_instruction_triggers.sql`).
  - `instruction_delegations` is revoke-only: a trigger prevents deletes and un-revokes (`20261217090000_instruction_delegations.sql:35-59`).
- **Grant contract** (`packages/contracts/src/q/instructions.ts`):
  - `INSTRUCTION_AUTO_ELIGIBLE_ACTIONS = [relationship.interest.express, chat.message.send, schedule.meeting.book]` (`:30-34`).
  - `DELEGATED_ROUTINE_ACTIONS = [chat.message.send, schedule.meeting.book]` (`:335-338`).
  - `INSTRUCTION_DELEGATION_WORDS = "Q may reply, follow up and set meetings without asking; asks first for money, terms and anything new"` (`:341-342`).
  - `DELEGATION_LIMITS`: `sendsPerDay` 10, `followUpAfterWorkingDays` 3, `followUpsInARow` 2, `unsendMinutes` 10 (`:345-353`).
  - The grant also carries `followUps`, `routineReplies`, `maxMessagesPerCounterpart`, `budgetUsdMonth` and `digest` (`:126-149`).
- **Approval of a grant.** `createInstructionActions` defines the action `q.instruction.grant` (CONFIRM_REQUIRED, one approval per grant version). Its card states the scope, budget, expiry and digest (`apps/q-api/src/composition/instructions/actions.ts:100-175`). `settleGrant` downgrades AUTO to ASK on anything that is not AUTO-eligible (`packages/app-actions/src/delegation.ts:15-40`).
- **Engine.** `createInstructionEngine` (`engine.ts:1679-3020`). The full firing is described in §2.
- **Triggers.** In `instructions/triggers.ts:1-151`:
  - `claimDue` uses skip-locked and **moves `next_fire_at` forward by `cadence_minutes` before firing** (`store.ts:345-360`).
  - The 60 s `setInterval` sweep is at `main.ts:1892-1900`.
  - Approval calls `onActivated` and then a sweep (`main.ts:3215-3227`).
  - Relationship moves wake instructions through `Q_WORK_WAKE_CHANNEL`, and chat messages wake them through `Q_INSTRUCTION_WAKE_CHANNEL` (`main.ts:4504-4565`).
  - Missed moves are caught up on restart (`catchUpMoves`).
  - Outside working hours, the firing is deferred by 30 min (`triggers.ts:16,47-50`).
- **Planner.** `INSTRUCTION_PLAN` v8 ACTIVE, task class `STRUCTURED_EXTRACTION`, `maxAttempts` 1, cost cap $0.08, 2 000 output tokens, 60 s timeout (`instructions/planner.ts:26,85-108`). The prompt is in `evidence/agents/agent-prompts.md`.
- **Quarantined thread reader.** `INSTRUCTION_THREAD_READER` v3, `STRUCTURED_EXTRACTION`, 1 attempt, 300 tokens, 30 s timeout (`instructions/quarantine.ts:271-308`). Its rule "When unsure, use the cautious value: mentionsTermsOrMoney true, declined true" is at `instructions.v1.ts:436-437`.
- **ASK cards.** `createInstructionAsk` creates a Q run with capability `PREPARE_ACTION` in the instruction's own conversation, then calls `actions.propose(app.<name>)`. If the card already exists, the run is completed (`instructions/ask.ts:1-153`).
- **Delegation toggle.** `q.work.delegation.set` is an app action of class INSTANT (`packages/app-actions/src/actions/work.ts:115-160`). It is implemented at `apps/api/src/q-work-port.ts:46-105`: it inserts or revokes the delegation row, sets `next_fire_at = now()` when switched on, and writes audit events `DELEGATION_ENABLED` / `DELEGATION_REVOKED`.
- **Digest.** S7 daily or weekly digest; `needsYouNotice` (`instructions/digest.ts:32-52`).
- **Held retry.** "Ask Q to try again" is `engine.retryHeld` (`engine.ts:2867-3020`). There is also a stale-hold sweep, `createHeldRetry` (`workforce/held-retry.ts`), which runs on wake-listener catch-up (`main.ts:4516`).

### 1.2 Workforce (jobs, drafts, grades, outcomes, handoffs, feedback) — PARTIAL

- **Registry** (`packages/q-orchestrator/src/workforce/registry.ts:17-140`) has 10 roles: LEAD, OUTREACH, MANDATE_WATCHER, CONVERSATION, WRITER, REVIEWER, SCHEDULER, DOCUMENTS, RESEARCH and AD_HOC. Tools and budgets are set per role (see §3). `OUTWARD_TOOLS` is `chat.message.send`, `email.send` and `relationship.connection_request.send` (`:32-36`).
- **Plan bounding.** `boundPlan` (`plan.ts:69-143`) caps a job at 12 steps (`MAX_JOB_STEPS`), filters each step's tools to the intersection of role tools and permitted tools, and refuses with UNKNOWN_ROLE, NO_PERMITTED_TOOL, WAITS_ON_MISSING_STEP, OVER_BUDGET and similar codes. **WRITER and REVIEWER steps are kept even with no tools** (`DRAFT_ROLES`, `:66,107`).
- **Runner.** `runJob` (`job-runner.ts:94-192`) runs steps in order. A step whose dependency did not finish DONE is SKIPPED. **A step with no executor is HELD with "No agent can do this step on its own; it needs you."** (`:164-168`).
- **Executors.** `createWorkforceExecutors` (`apps/q-api/src/composition/workforce/jobs.ts:135-338`) implements only:
  - `MANDATE_WATCHER: watcher`
  - `OUTREACH: watcher` — expresses interest only; it never sends the "first messages" its registry text promises.
  - `CONVERSATION: conversation("REPLY")`
  - `SCHEDULER: conversation("SCHEDULE")`

  WRITER, REVIEWER, DOCUMENTS, RESEARCH and AD_HOC have no executor. AD_HOC falls back to a covering role's executor if one exists (`job-runner.ts:76-92`).

- **Tools the lead may plan with.** `EXECUTABLE_JOB_TOOLS` is search_companies, list_my_relationships, relationship.interest.express, list_messages, chat.message.send, find_meeting_times, list_schedule and schedule.meeting.book (`jobs.ts:362-371`). The roster text still advertises email.send, diligence tools and research_public_web (`registry.ts:104-129`), which a plan can never be permitted to use.
- **Approval.** `q.workforce.job.start` (CONFIRM_REQUIRED). Approval binds to the bounded plan, and execution runs as `void jobs.run(...)` (`workforce/job-actions.ts:268-338`).
- **Recording.** `workforce/store.ts`: `ensureJob`, `startRun`, `endRun`, `addDraft`, `addGrade`, `addOutcome`, `handoff`. The migration `20261207090000_q_workforce.sql` keeps runs append-only through triggers (`:240-281`) and makes the job's status the only mutable column.
- **Learning and feedback.** `workforce/learning.ts` writes APPROVED, EDITED, REJECTED, REPLIED and NO_REPLY feedback rows, and turns an edit into a preference through the Write Gate. The test is `apps/q-api/test/workforce-job.test.ts:476`. Not inspected in depth.

### 1.3 Errands — IMPLEMENTED (one false-success defect)

- `q.errand.start` is approved once against the exact plan: the opening message, the brief word for word, and the call (`errands.ts:56-75,162-310`).
- The runner `createErrandRunner` (`:687-1516`) runs serially. Each step re-resolves the actor. Stages are WAITING_CONNECTION, CONVERSING, CALL_BOOKED and FINISHED.
- Replies go through `reviewedReply` (review, then send). A held reply goes to the person as a `forPerson` line (`:1384-1446`).
- Q's messages are marked viaQ through `qDelegationId: row.id` (`:780-789`).
- **Defect D-06.** When `post()` returns false or throws, the errand still records `repliesSent+1` and "Q answered X", and moves `seenUntil` past the message (`:1418-1436`).

### 1.4 Delegated work / q-work (LangGraph) — IMPLEMENTED (not deeply audited)

- `createQWorkEngine` (`packages/q-orchestrator/src/work/engine.ts:53`) defines the graphs:
  - lane: `wait`, `gate`, `acceptance`, `chat`, `interview`, `report`, `times`, `decide` (`lane.ts:834-841`)
  - outreach: `source`, `shortlist`, `open` (`outreach.ts:217-219`)
  - stand-in (`stand-in.ts:267-268`)
- Checkpoints are kept in Postgres (`QCheckpointStore`), and `Q_WORK_GRAPH_VERSION = 1`.
- The runtime ports (`work/runtime.ts:60-200`) re-resolve the actor, then call the same Express Interest, chat and calendar commands under step-scoped idempotency keys. Replies pass through `reviewedReply` with `createPassedDrafts`, an in-memory "sent" ledger.
- Kill switch: `q.autonomy.delegations` (`main.ts:4307`; seeded `true` in `20261115000000_platform_ops_admin.sql:215`).

### 1.5 Scheduler and sweeps (all in `apps/q-api/src/main.ts`)

| Interval | What                                                                                                                     | Line      |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| 60 s     | `instructionTriggers.sweep()` (claims ≤10 due instructions; digests; resolves answered notices)                          | 1892      |
| 60 s     | `workRuntime.tick()` (delegated work)                                                                                    | 4499      |
| per tick | `errands.tick()` if `q.autonomy.errands`                                                                                 | 4268-4275 |
| 2 min    | `approvedActionSweep` (approved actions nobody executed)                                                                 | 3816      |
| 5 min    | orphaned run sweep (paused runs expire after 24 h)                                                                       | 3851      |
| 6 h      | `runScout`                                                                                                               | 5001      |
| LISTEN   | `Q_WORK_WAKE_CHANNEL` → instructions, errands, delegations; `Q_INSTRUCTION_WAKE_CHANNEL` → instructions; catch-up sweeps | 4504-4565 |

`apps/workers` does not run any agent work. It publishes the outbox events that drive the wake channels, delivers notices (`apps/workers/src/integrations/notice-delivery-ticker.ts`, plus Web Push and email in `packages/communication/src/push/delivery.ts`), and polls Gmail.

---

## 2. Lifecycle of a complex task (12 stages)

The path traced is a **standing instruction** answering a counterpart's chat message, which is today's case. The workforce-job path is shown where it differs.

| #   | Stage        | Exists?       | Where (path:line)                                                                                                                                                                                                                                                                                                            | Notes                                                                                                                                                                                                                      |
| --- | ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Interpret    | YES           | Goal text kept verbatim in the grant. Thread facts come from the quarantined reader (`engine.ts:1884-1923`, `quarantine.ts:271-308`). Questions are routed through `questionVerdict` (`engine.ts:1045`, used at `:2006-2048`).                                                                                               | The reader's cautious default `declined:true` removes the person from `replyWaiting` (`engine.ts:2065`), so no REPLY_WAITING notice is sent (D-10).                                                                        |
| 2   | Plan         | YES           | `dependencies.plan(...)` (`engine.ts:2117-2163`), INSTRUCTION_PLAN v8                                                                                                                                                                                                                                                        | The plan is limited to the grant's declared actions. No read tools are given to the planner.                                                                                                                               |
| 3   | Select agent | PARTIAL       | Instructions use no agent selection: one planner, and code decides. Jobs use `executorFor` (`job-runner.ts:76-92`).                                                                                                                                                                                                          | 6 of 10 roles have no executor (D-02).                                                                                                                                                                                     |
| 4   | Delegate     | YES           | Grant mode, `delegatedStep` (`engine.ts:539-553`), DELEGATION_LIMITS cap (`:934-948`)                                                                                                                                                                                                                                        | Delegation needs both the DB row **and** `CQ_INSTRUCTIONS_AUTO=on` (`main.ts:1902`, `engine.ts:2560-2580`).                                                                                                                |
| 5   | Tools        | YES (narrow)  | `validateStep` accepts only CONSEQUENTIAL `APP_ACTIONS` in the grant (`engine.ts:607-628`). AUTO runs `action.authorize` then `action.run` (`:2587-2606`).                                                                                                                                                                   | `email.send` is not an app action, so an instruction plan that names it gets UNKNOWN_ACTION (see 08 §3).                                                                                                                   |
| 6   | Persist      | YES           | `store.recordStep` (DONE, ASKED, REFUSED, FAILED, NOTED) with `idempotency_key = instr:<id>:<runKey>:<index>` (`engine.ts:2502-2525`)                                                                                                                                                                                        | `stepDone(key)` prevents a replay (`:2508`).                                                                                                                                                                               |
| 7   | Obstacles    | YES           | Refusal codes (`:127-161`), ASK codes (`:303-334`), HOLD (consider step) (`:779-794`, `:858-878`), NOT_CONNECTED_YET dropped (`:2540-2547`)                                                                                                                                                                                  | The obstacles are many and stack (§4).                                                                                                                                                                                     |
| 8   | Retry        | PARTIAL       | Replan up to `MAX_REPLANS=2` (+1 "NO REPLY PLANNED" nudge) (`:2116,2238-2262`). Reviewer redraft once (`review-loop.ts:45-50`). "Ask Q to try again" (`engine.ts:2867`). Stale-hold sweep.                                                                                                                                   | PLANNER_UNAVAILABLE returns with nothing recorded, and the next try is a full cadence later because `claimDue` already moved `next_fire_at` +240 min (D-05). The model gateway retries per its budget (planner 1 attempt). |
| 9   | Validate     | YES           | Code checks in `validateStep` / `messageProblem` (`:1165-1280`). Reviewer rubric (`review-loop.ts:100-146`). Thread consistency (`thread-consistency.ts:52-140`).                                                                                                                                                            | Integrity rules cannot be averaged away.                                                                                                                                                                                   |
| 10  | Artifacts    | YES (records) | `workforce_drafts`, `workforce_grades`, `workforce_draft_outcomes` (`review.ts:299-379`)                                                                                                                                                                                                                                     | A near-miss draft is recorded as HELD even though it became a card (D-03).                                                                                                                                                 |
| 11  | Deliver      | YES           | AUTO: `chat.message.send` through the app action (`engine.ts:2603`). ASK: an Approval Engine card (`:2687-2735`).                                                                                                                                                                                                            | AUTO/delegated sends are **not marked viaQ** (D-07).                                                                                                                                                                       |
| 12  | Notify       | YES           | `store.notify` → `communication.notifications` (`store.ts:565-586`). NEEDS_YOU at once (`engine.ts:2829-2843`). REPLY_WAITING (`:2783-2800`). Questions (`:2024-2034`). Budget (`:1741-1752`). Digest. Push and email by workers (`packages/communication/src/push/delivery.ts:1-40`: email after 10 min unread, push once). | Nothing escalates a waiting card, and lapsed cards go silent (D-01).                                                                                                                                                       |

For **workforce jobs** the stages map as follows: interpret = JOB_PLAN; plan = boundPlan; select = executorFor; tools = WorkforcePorts (not the tool registry); persist = workforce tables; retry = none (no resume; a thrown run leaves the job RUNNING); validate = reviewer; deliver = `ports.send`; notify = only for a possible "no" or an unreadable reply (`jobs.ts:224-240`). **Held drafts are not notified** (`jobs.ts:286-289`, D-09).

---

## 3. Agent types

Prompts (sanitized, with original line numbers) are in `evidence/agents/agent-prompts.md`. Every model call goes through the Q Model Gateway by task class. No call is made from feature code directly.

| Agent                                                    | Purpose                                                                                                                                                  | Tools                                                       | Model / task class / budget                                                                             | Prompt                                                             | Entry point                                                              | Limits                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instruction planner** ("Q" for a standing instruction) | Plans the next ≤10 steps as declared app actions with JSON args                                                                                          | None (the declared action list is rendered into the prompt) | `STRUCTURED_EXTRACTION`, 1 attempt, ≤$0.08, 2 000 tok, 60 s (`planner.ts:85-108`)                       | `INSTRUCTION_PLAN` v8 (`instructions.v1.ts:40-75,372-413`)         | `engine.fire` (`engine.ts:2116`)                                         | MAX_REPLANS 2 (+1 nudge); monthly budget S5 (`:1861-1866,2113`)                                                                                                                                                                                      |
| **Quarantined thread reader**                            | Reads one thread into typed facts only                                                                                                                   | None                                                        | `STRUCTURED_EXTRACTION`, 1 attempt, 300 tok, 30 s (`quarantine.ts:271-308`)                             | `INSTRUCTION_THREAD_READER` v3 (`instructions.v1.ts:415-440`+)     | `engine.ts:1884-1923`                                                    | THREADS_PER_FIRING 8 (`:78`); cost from budget less one plan                                                                                                                                                                                         |
| **Writer** (first draft)                                 | Instructions: the planner's step text. Errands, jobs, delegations: `ERRAND_REPLY` composer                                                               | None                                                        | `createErrandReplyComposer` (`errands.ts:432-506`)                                                      | `errand-reply.v1.ts`                                               | `review.prepare` and the path's composer                                 | Jobs' writer is called with **`brief: ""`** (`main.ts:1464`)                                                                                                                                                                                         |
| **Redraft (writer)**                                     | Rewrites from the numbered fix list                                                                                                                      | None                                                        | `STRUCTURED_EXTRACTION`, SMALL: 2 attempts, ≤$0.03, 900 tok, 30 s (`workforce/models.ts:58-63,190-204`) | `DRAFT_REDRAFT` v3 ACTIVE (`workforce.v1.ts:153-179,266-289`)      | `writeWithReview` → `ports.redraft` (`review-loop.ts:384`)               | 1 redraft (`REVIEW_ROUNDS_MAX-1`); a code-check fix may take a second redraft call within the same round (`:399-414`)                                                                                                                                |
| **Reviewer**                                             | Grades 6 criteria 0–5 and 4–5 integrity rules; code computes the score                                                                                   | None                                                        | `STRUCTURED_EXTRACTION`, SMALL (`models.ts:176-189`); etiquette `SPEAK_FOR`                             | `DRAFT_REVIEW` v3 ACTIVE (`workforce.v1.ts:46-81,107-125,233-264`) | `OutwardReview.review` (`review.ts:248-401`)                             | Weights WARM 15, ASK_TIMING 20, ANSWERS 20, CONCISE 15, SIGNALS 15, PERSONAL_STYLE 15 (`review-loop.ts:24-31`). **Threshold 75** (`:47-50`). **REVIEW_ROUNDS_MAX 2** (`:45`). Unreachable reviewer means HELD. NEAR_MISS_POINTS 10 (`review.ts:92`). |
| **Thread consistency** (code, not a model)               | Finds a meeting, document or question their latest message left open, and fails drafts that ignore it or re-ask "open to connecting?"                    | n/a                                                         | Deterministic regex (`thread-consistency.ts:29-140`)                                                    | n/a                                                                | `review.ts:267-279`                                                      | Applies only when stage is REPLY and `theirLatest` is given. **The job CONVERSATION path never passes `theirLatest`** (`jobs.ts:265-283`), so the check is off there.                                                                                |
| **Reply reader**                                         | Classifies the counterpart's latest message: stance, tone, wantsMeeting, requests                                                                        | None                                                        | `FAST_CLASSIFICATION`, CLASSIFY: 2 attempts, ≤$0.005, 300 tok, 10 s (`models.ts:64-69,205-217`)         | `REPLY_READER` v1 (`workforce.v1.ts:291-316`)                      | Jobs (`jobs.ts:205-221`), delegated work (`work/runtime.ts` `readReply`) | Null, decline or negative tone hands the reply to the person                                                                                                                                                                                         |
| **Job plan (lead Q)**                                    | Splits a goal into role-owned steps                                                                                                                      | Roster restricted to permitted tools                        | `STRUCTURED_EXTRACTION`, PLAN: 1 attempt, ≤$0.08, 2 000 tok, 60 s (`models.ts:70-75,218-230`)           | `JOB_PLAN` v1 (`workforce.v1.ts:343-364`)                          | `propose_q_job` → `jobs.plan` (`jobs.ts:397-421`)                        | MAX_JOB_STEPS 12, job budget default $0.50 (`jobs.ts:374`), monthly limit `workforceMonthlyLimitUsd`                                                                                                                                                 |
| **Job executors**                                        | MANDATE_WATCHER and OUTREACH: express interest in mandate matches. CONVERSATION: read, write, review, send replies. SCHEDULER: book the first free slot. | `WorkforcePorts` (`jobs.ts:51-98`), not the Q tool registry | n/a                                                                                                     | n/a                                                                | `runJob`                                                                 | MAX_PER_STEP 25 (`jobs.ts:100`). Scheduler books `slots[0]` with no counterpart confirmation (`jobs.ts:244-257`).                                                                                                                                    |
| **Errand runner**                                        | Opens, answers from the brief, books, notifies                                                                                                           | Chat, schedule and relationship services                    | Composer plus reviewer                                                                                  | `errand-reply.v1.ts`                                               | `errands.tick` / `wake`                                                  | MAX_REPLIES, one nudge                                                                                                                                                                                                                               |
| **Delegated-work graphs**                                | Outreach shortlist and lanes, stand-in                                                                                                                   | `QWorkPorts`                                                | Composers (`work/composers.ts`), reply reader, reviewer                                                 | `q-work.v1.ts`, `delegation-reader.v5.ts`                          | `workRuntime.tick` / `wake`                                              | RECURSION_LIMIT 80 (`work/engine.ts`)                                                                                                                                                                                                                |

Two arithmetic notes on the reviewer:

- The six weights sum to 100, and each criterion contributes `score/5 × weight`. To reach 75, the drafts must average at least 3.75/5 across all six criteria.
- PERSONAL_STYLE is graded "where one is given above". When the person has no etiquette guide, that 15-point criterion is whatever the model decides to give. This is a plausible structural drag on today's 58/68 scores. It is **unverified**; see `_findings/D.md`.

---

## 4. Real work vs described work

### 4.1 Where real execution happens (verified in code)

- Instruction AUTO steps call `verdict.action.authorize`, then `verdict.action.run` against `appActionPorts`. These are the same commands the person's own buttons run (`engine.ts:2587-2606`).
- Errands use `chat.send` and `schedule.schedule` (`errands.ts:780-789`).
- Jobs use `services.sendChat` and `book` (`workforce/ports.ts:199-208`, `main.ts:1451-1457,1477-1483`).
- None of these paths is mocked. Model calls are real gateway calls; tests use fakes.

### 4.2 Fake or overstated progress, invented results

| #   | What the person is told                                                            | What actually happened                                                                                                                                                                                   | Evidence                                                                                                  |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| a   | "Looked at N people: **nothing needs a reply right now**."                         | Emitted whenever **not every** reachable thread could be read. Causes include budget, the cap of 8 threads, or a reader failure. Unread is turned into "nothing needs a reply".                          | `engine.ts:2811-2824` (D-04)                                                                              |
| b   | Errand: "Q answered X."                                                            | `post()` failed or returned false. The message was not sent, but `repliesSent+1` was recorded and `seenUntil` moved past their message.                                                                  | `errands.ts:1418-1436` (D-06)                                                                             |
| c   | Job step "Replied to 0 people; held 2 drafts below the bar." with status **DONE**  | Nothing was sent and the person was not notified. The job is marked DONE if every step is DONE.                                                                                                          | `jobs.ts:286-289,309-325`, `jobs.ts:533-538` (D-09)                                                       |
| d   | Job step "No agent can do this step on its own; it needs you."                     | WRITER and REVIEWER have no executor. Every step after them is SKIPPED, so a reply job planned per the prompt never sends.                                                                               | `job-runner.ts:164-168`, `jobs.ts:333-338`; reproduction in `evidence/agents/repro-writer-step.md` (D-02) |
| e   | Team map / In progress: a job "RUNNING" for INSTRUCTION and DELEGATED_WORK sources | `workforceTracker` sets RUNNING on every firing, and **nothing ever sets it DONE or HELD**. The web hides the open LEAD run only for INSTRUCTION jobs, so a DELEGATED_WORK lead shows "Working" forever. | `jobs.ts:625-641`; `apps/web/src/features/work/workforce-agents.ts:181-189,612-628` (D-11)                |
| f   | Workforce page: near-miss draft "Held, not sent (below bar)"                       | The same draft is an approval card waiting for the person. `settle(...,"OFFERED")` is a no-op for HELD verdicts, so the outcome row never links the card.                                                | `review.ts:370-378,403-411`; `engine.ts:2392-2415,2714-2721`; `workforce/page.ts:241,269-289` (D-03)      |
| g   | Card wording "max redrafts 2" (`max_redrafts` stored 2)                            | The loop clamps to 1 redraft (`REVIEW_ROUNDS_MAX - 1`)                                                                                                                                                   | `jobs.ts:446,594,636` vs `review-loop.ts:45-50,306-309` (D-14, cosmetic)                                  |
| h   | Delegation toggle "Q now handles routine replies, follow-ups and meetings there."  | Only true when `CQ_INSTRUCTIONS_AUTO=on`. Otherwise every step is a card. Even when on, any draft that does not PASS at 75 becomes a card (65–74) or a refusal (<65).                                    | `work.ts` (app action `done`); `main.ts:1902`; `engine.ts:2560-2580,2392-2425` (D-12)                     |

### 4.3 Held or refused paths that leave a counterpart unanswered

Code paths that end with no reply sent **and** no prompt to the person (✗), or with a prompt (✓):

1. ✗ **An approval card that waits more than 24 h.**
   - The TTL is 24 h (`packages/q-actions/src/ports.ts:300`).
   - The Needs-you list drops it after expiry (`postgres-repositories.ts:410`).
   - Expiry is only written when someone decides (`service.ts:1309-1312`).
   - `awaitingAnswer` and `waitingCards` do not filter `expires_at` (`instructions/store.ts:715-776`), so the engine HOLDs ALREADY_ASKED (`engine.ts:726-733`), excludes the person from `replyWaiting` (`:2065-2068`), and tells the planner "plan none of these again" (`:2151-2159`).
   - `staleCards` supersedes a card only if they wrote again or the card opened cold (`:1100-1140`).
   - **Result: the conversation is silently parked indefinitely.** (D-01, High.) Today's card was created around 11:19 UTC 8 Oct, so this lapses around 11:19 UTC 9 Oct unless approved.
2. ✗ **The planner is unavailable or a firing throws.** No step, no note, no notice, and the next attempt is 240 min later (`engine.ts:2170`; `store.ts:345-360`; `triggers.ts:66-71`). (D-05.)
3. ✗ **The thread reader says `declined:true` when unsure** (`instructions.v1.ts:437`). The person is excluded from `replyWaiting`. Unless the planner still drafts something (which then becomes a THEY_DECLINED card), nothing is said. (D-10.)
4. ✓ **Every drafted reply refused**, for example BELOW_THE_BAR or UNANSWERED_QUESTION. A REPLY_WAITING step plus a NEEDS_YOU notice names the refusal codes (`engine.ts:2746-2800`). This was added 8 Oct; before 8 Oct this path was ✗ (git `855b1541`, `ee304b16`).
5. ✓ **Their question is outside declared facts.** A NEEDS_YOU "asked something only you can answer" notice (`:2006-2048`).
6. ✓/✗ **HOLD (pace, ONE_AT_A_TIME, ALREADY_ASKED, TOO_SOON).** Only a NOTED step on the Team map, with no notice (`:2527-2537`). This is acceptable for pacing, and ✗ when combined with item 1.
7. ✗ **Workforce job CONVERSATION hold.** Counted only (`jobs.ts:286-289`). (D-09.)
8. ✓ **Errand hold.** `heldLine` is sent to the person (`review.ts:141-156`, `errands.ts:1437-1445`).
9. ✗ **Outside working hours** (by design, noted once a day). A weekend message waits until Monday.

### 4.4 Today's evidence, explained by the code

The seeded founder's standing instruction went through these runs:

1. **BELOW_BAR.** Before the near-miss change, a held draft became REFUSED BELOW_THE_BAR, and before `855b1541` there was no REPLY_WAITING notice.
2. **THREAD_MISMATCH.** `threadProblems` or RESPONDS_TO_THREAD failed (`review-loop.ts:358-372`).
3. **After `ee304b16` (11:19 UTC):** draft 1 scored 58 and draft 2 scored 68. Integrity was clean and code had no problems, so `best.score 68 ≥ 75-10` gave a nearMiss (`review-loop.ts:282-297`). That became ASK NEAR_THE_BAR (`engine.ts:2392-2415`), which is an AWAITING_APPROVAL card plus a "1 thing needs your yes" notice.

So the roughly 21 h without a reply is the product of (i) earlier firings refusing or holding without telling the person, and (ii) the current design, in which a near-miss waits for the person indefinitely, with no escalation and no expiry handling (D-01).

---

## 5. Approvals, idempotency, autonomy, budgets, cadence

- **Approvals.**
  - Instruction ASK steps produce `app.<action>` cards through `actions.propose` on a fresh Q run (`ask.ts:54-118`).
  - Approval re-verifies authority at execution through the approved continuation (`main.ts:3797-3804`).
  - The approved-action sweep runs actions nobody executed, every 2 min (`main.ts:3806-3826`).
  - An approval binds to the exact payload. An edit in Work is the person's own send, and the card is declined (`decision-queue.tsx:57-66`).
- **Idempotency.**
  - Instruction step key `instr:<id>:<runKey>:<i>`, replaced into the action input when the schema has `idempotencyKey` (`engine.ts:557-572`). `stepDone` is checked before acting (`:2508`).
  - Budget card key per month (`:1728`). Notices are deduped on `(user_id, dedupe_key)` (`store.ts:575-584`).
  - Errands use `errand:<id>:<step>`. Jobs use `wf:<jobId>:reply:<msgId>` and `wf:<jobId>:book:<rel>` (`jobs.ts:246-251,293-297`).
- **Autonomy toggles.** Three gates stack:
  1. The environment switch `CQ_INSTRUCTIONS_AUTO` (`main.ts:1902`). It defaults off: "autonomy off, every step is asked". The ledger says it has been on since 2026-10-03 (`docs/handoff/research/ledger.md:320`), but the production value **was not verified**.
  2. The per-instruction delegation row ("Q may reply… without asking", `contracts …/instructions.ts:341-342`). It needs `auditDelegated` composed (`engine.ts:1817-1823`) and a matched relationship (`:539-553`).
  3. The kill switches `q.autonomy.errands` and `q.autonomy.delegations` (DB flags, seeded true).
  - Even with all three on, a delegated message goes out only if the reviewer **PASSED** it (`engine.ts:2569-2580`). Otherwise it becomes a card (`NOT_REVIEWED`, `NEAR_THE_BAR`) or a refusal.
- **Budgets.**
  - Monthly per instruction (`budget_usd_month`, `spent_usd_month`, in micro-dollars, `engine.ts:1861-1866`). When the budget runs out, the instruction pauses with a "continue at 2×" card (`:1705-1758`).
  - Per job: $0.50, with role budgets of $0.05–0.10 (`registry.ts`). There is a monthly workforce limit (`main.ts:1401,1420-1426`).
  - Per call, see the table in §3. Draft jobs filed by the reviewer for instructions also get a $0.50 job budget (`review.ts:189`). That is a display figure only; it is not enforced per draft.
- **Cadence.** `cadence_minutes` defaults to 240, within 30–10 080 (migration). The claim moves `next_fire_at` forward before running. Wakes (approval, chat, relationship move, delegation on, resume) set `next_fire_at` to now. Outside working hours, the instruction is deferred 30 min. The sweep runs every 60 s.

---

## 6. Persistence and resumability

| Engine                     | Survives refresh      | Survives process restart / long runs                                                                                                                                                          | Evidence                                           |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Instructions               | Yes (all in Postgres) | Yes. A firing is re-planned from scratch at the next claim, and step keys stop duplicates. A firing interrupted mid-way loses that firing's unrecorded steps, which are re-planned later.     | `store.ts`, `engine.ts:2508`                       |
| Errands                    | Yes                   | Yes. The DB stage machine resumes on the next tick, and the serial chain avoids concurrent advances.                                                                                          | `errands.ts:731-740,1466-1500`                     |
| Delegated work             | Yes                   | Yes. LangGraph checkpoints in Postgres; a version mismatch is "reported, never silently restarted".                                                                                           | `work/engine.ts:21-31`                             |
| Workforce jobs             | Records yes           | **No.** `void jobs.run(...)` runs in memory after approval. On a restart or throw, runs stay RUNNING and the job stays RUNNING with no resume and no FAILED status.                           | `job-actions.ts:305-325`; `jobs.ts:509-553` (D-08) |
| Passed-draft "sent" ledger | n/a                   | In memory. A restart loses only the "sent" outcome line (documented).                                                                                                                         | `review.ts:481-507`                                |
| Orphaned Q runs            | n/a                   | Swept every 5 min. A paused run (card) is EXPIRED after 24 h, **but the action and approval rows are not touched** (`orphaned-runs.ts:91-110`; q-runtime does not touch `q_runtime.actions`). | Feeds D-01                                         |

---

## 7. Frontend: the Work page

Route: `apps/web/app/(app)/work/page.tsx:58-123`. Five server reads run in parallel:

- `pendingQApprovalsAction` → `GET /v1/q/approvals` → `listPendingApprovals` (PENDING and not expired)
- `listWorkAction`
- `listDoneAction` (instruction steps DONE plus finished delegations, `apps/q-api/src/composition/work/page.ts:513-585`)
- `listSuggestionsAction`
- `loadWorkforceAction`

The first 10 approval views are read in full. On the client, `useNotices()` polls every 60 s (`notice-store.ts:23,128`) and `useWorkforceLive` re-reads the team.

**Real state or simulated?** Everything shown comes from server records. There are no timers that fake progress, and no `Math.random`. The only client-side "state" is `localStorage` for dismissed held drafts (`decision-queue.tsx:140-198`), which is a per-browser convenience. The UI reflects the stores, and several of those stores record the wrong thing (D-03, D-11).

**"Needs you 0 — Nothing waits on you" above two notice rows (today).**

- Before the lead's fix, `count` came only from `groups` (approval cards plus held drafts). The notices were rendered through `extra` and not counted.
- Now `count = Σ group.items + extraCount`, where `extraCount = timeLanes.length + notices.length` (`decision-queue.tsx:224-228`; `work-page.tsx:240-266`).
- **Why there were 0 groups:**
  - Earlier in the day there was no approval card. The runs were BELOW_BAR and THREAD_MISMATCH, which are refusals, not cards.
  - Held drafts appear only if a workforce draft has outcome HELD within 7 days and is not dismissed (`decisions.ts:85-125`).
  - Before `89e7ad98` (7 Oct 11:03) `GET /v1/q/approvals` returned 500 whenever a card waited (`q-approvals.ts:170-173`), and the page showed "couldn't load".
- **Remaining issues after the fix:**
  1. **Double counting.** An instruction card plus its "1 thing needs your yes" NEEDS_YOU notice count as 2 (`engine.ts:2829-2843`; `notice-groups.ts`). A near-miss draft is also listed **twice**: as the APPROVAL item and as a HELD item from `heldDecisions` (its outcome row says HELD) (`decisions.ts:85-125,198-231`). The HELD item offers "Send as is", which sends directly while the approval card is still pending, so there is a double-send risk (`held-actions.ts:44-58`). (D-03 / D-13.)
  2. **Instruction message cards are not shown as messages.** The decision card renders the quote and verbs only for `actionType === "chat.message.send"` (`decision-queue.tsx:441-444`) and the title helper is the same (`decisions.ts:285-290`). Instruction cards are `app.chat.message.send` (`engine.ts:2690`, `2978`), so they fall back to the generic plan view. This is untested: `apps/web/test/work-decisions.test.tsx:218` uses `chat.message.send` only. (D-15.)
  3. A lapsed card disappears from the list while the engine still holds the conversation (D-01).
- **Team map.**
  - `workforce-agents.ts` derives agent states from runs. It suppresses the open LEAD run of INSTRUCTION jobs (`:181-189`, `:612-618`) but not of DELEGATED_WORK jobs (D-11).
  - The "Next run" time comes from the instruction schedule.
  - Run states are real DB states, but they are stale where the store never closes runs.

---

## 8. Classification table

| Feature                                                              | Class                                                   | Key evidence                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Standing instruction engine (plan → validate → AUTO/ASK/REFUSE/HOLD) | IMPLEMENTED (defects D-01, D-04, D-05, D-07, D-10)      | `engine.ts:1679-3020`; 66 tests pass (`evidence/agents/tests-run.md`) |
| Cadence sweep and wakes                                              | IMPLEMENTED                                             | `triggers.ts`, `main.ts:1887-1900,4504-4565`                          |
| Scoped delegation ("without asking")                                 | IMPLEMENTED, gated by env (production value unverified) | `q-work-port.ts:46-105`, `engine.ts:2560-2580`                        |
| Writer → reviewer loop (75, 2 rounds, near miss)                     | IMPLEMENTED                                             | `review-loop.ts`                                                      |
| Thread consistency                                                   | IMPLEMENTED (not applied on the job path)               | `thread-consistency.ts`; `jobs.ts:265-283`                            |
| Near-miss → card                                                     | IMPLEMENTED, mis-recorded                               | D-03                                                                  |
| Workforce jobs (lead plan → agents)                                  | PARTIAL / BROKEN for any WRITER or REVIEWER plan        | D-02 (reproduced)                                                     |
| DOCUMENTS / RESEARCH / WRITER / REVIEWER executors                   | PLANNED (roster only)                                   | `jobs.ts:333-338`                                                     |
| Job resumability                                                     | BROKEN (fire-and-forget)                                | D-08                                                                  |
| Errands                                                              | IMPLEMENTED (false success on send failure, D-06)       | `errands.ts`                                                          |
| Delegated work (LangGraph)                                           | IMPLEMENTED (not deeply audited)                        | `work/*`                                                              |
| Work page Needs you / Done / In progress                             | IMPLEMENTED (count and grouping defects D-13, D-15)     | `work-page.tsx`, `decision-queue.tsx`                                 |
| Team map                                                             | IMPLEMENTED (stale RUNNING, D-11)                       | `workforce-agents.ts`                                                 |
| Notifications: in-app, Web Push, email after 10 min                  | IMPLEMENTED; push CONFIGURED only when VAPID is set     | `delivery.ts`, `apps/workers/src/main.ts:1142-1165`                   |
| Escalation for an unanswered card                                    | NOT IMPLEMENTED                                         | —                                                                     |

## 9. Not inspected

- The LangGraph lane, outreach and stand-in node bodies, beyond the node lists.
- `workforce/learning.ts` in depth.
- `instructions/material.ts` `checkMessage` internals.
- `q-core` `wooProblem` and `considerOutreach` internals.
- Production database rows and environment values.
- The arrival briefing (another investigator's area).
