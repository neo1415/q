# Agent execution matrix — the agent architecture as built (audited 2026-10-11 at `b021d53b`)

## Diligence correction — 2026-10-28 (branch `fix/diligence`, LOCAL TESTED, not deployed)

DOCUMENTS and DILIGENCE are registered executors (see section 2). "Do due diligence on X / a memo on X" no longer takes the model-free MEMO assembly:

- Plan validation (`withDiligenceResearch`, q-orchestrator plan.ts) turns an unbound NAMED_COMPANY MEMO or INVESTMENT_BRIEF into a diligence ANALYSIS (`profile: "DILIGENCE"`) and makes it wait on a RESEARCH step. It uses one the plan already has, or adds one when research runs and is permitted. JOB_PLAN v14 teaches that shape.
- The RESEARCH step researches the named company. RESEARCH_PLAN v3 adds founders and team, customers, litigation and regulatory, funding and traction.
- The writer (ANALYSIS_WRITE v4) writes fixed sections. Code adds three of its own: Claims vs evidence, Sources and Not known.
- The memo reads the data room through the Data room tab's own view, as the person (OPEN/OWNER documents only, bounded). It also sets stated figures against public facts deterministically (claims.ts): CORROBORATED / CONTRADICTED / UNVERIFIED.
- Per-job search budget: `Q_WORKFORCE_JOB_SEARCH_BUDGET`, default 8, planned calls included. Planned page reads: `Q_RESEARCH_PLANNED_EXTRACT_MS`, default 8 s.

## Current evidence checkpoint — 2026-10-11 20:56 UTC

The live baseline is exact green `9261cdc4`, all four Railway services SUCCESS. The monthly start guard is deployed and fails closed for an unavailable/malformed spend ledger; durable aggregate job reservations remain missing. The existing workforce document bridge has produced a real READY ONE_PAGER, preserved version 1 through same-artifact conversational revision to version 2, rendered the viewer and exported a changed valid one-page PDF. All three canonical findings and nine gaps remain intact; the viewer's dedicated “Evidence gaps” section was verified after a warm retry. Cold document opening still needs a readiness correction.

PREPARING never completes a workforce step. The existing artifact service reads the actual immutable version and rejects a damaged READY pointer, independently of the adapter's positive version check. A fresh focused run passes 24 document-job/adapter/executor regressions, including absent versions, PREPARING polling and cancellation.

These are narrow document execution capabilities, not full autonomous research, writing, design, critique and iterative intelligence. The existing `runDocumentPipeline` remains the reuse target; no second platform was added. The initial deterministic bridge deliberately has no paid generation until durable aggregate reservation exists. Historical roster/gap observations below describe `b021d53b`; continuation checkpoints record the changes since that audit.

Offscreen named-founder attribution is live verified at the existing release; Discover-to-selected-company analysis, cold Ask Q opening and the exact two-company browser comparison remain under acceptance. Product fixes at `06872c7c` pass local gates and are pushed/integrated, with exact CI `38173610861` in progress (pgTAP SUCCESS, quality pending; manual e2e SKIPPED). See STATE.md for the eventual exact release and browser receipts.

> Read-only audit for the Codex handoff. Every claim cites file:line and is tagged CODE OBSERVED or INFERRED. No replacement architecture was implemented. The founder's proposed agent architecture document (in `capital-q-codex-source-pack.zip`) was **not supplied to the Claude session**; reconcile it here when available.

Repo `neo1415/q` at `b021d53b`. Method: grep/sed/read only.
Tags: [CO] = CODE OBSERVED (read in code). [INF] = INFERRED (reasoned from code, not run).
Paths are relative to the repo root unless stated.

## Historical correction checkpoint — 2026-10-11 18:15 UTC

The monthly start guard no longer fails open on an unavailable ledger or malformed spend. Proposals refuse planning; approved queued jobs are held with a spending-check explanation. Four old-code regression failures become 40 passing workforce tests; package builds, root/q-api types and changed lint/format pass. **LOCAL TESTED**, awaiting its own release gates. Historical fail-open observations below describe the audited baseline. There is still no durable aggregate paid-job reservation; a measured-spend check between steps alone cannot protect concurrent calls or crashes.

All four services now serve exact green `c950e29b`. The initial autonomous document READY/render flow is live, and same-conversation workforce revision produces real version 2. It fails the requested new evidence-gap section; actual offscreen named-founder findings still bind the wrong company. Neither is final intelligent document or complete investor journey acceptance.

## Codex continuation — 2026-10-11

The existing durable runner now starts both claimed jobs immediately and awaits
all outcomes before ending/coalescing a pass. Each job keeps sequential steps,
owner validation, heartbeat, cancellation and retry behavior. Deferred-job and
queue-recovery regressions passed locally. Deployment is pending.

The existing document pipeline now has an IMPLEMENTED own-company workforce
connection, pending release gates. Typed approved PREPARE requests reuse the
composed specialist, real firewall, artifact service and document worker.
Atomic job/step binding prevents duplicate artifacts/enqueues; PREPARING remains
running under heartbeat until a real READY version. No paid generation runs in
this initial workforce path because no durable aggregate budget reservation
exists. Foreground document stages retain their configuration. See
[WORKFORCE-DOCUMENTS.md](WORKFORCE-DOCUMENTS.md) for limitations and tests.
The roster and gap inventory below retain their historical baseline evidence.

## 1. Big picture: three agent engines plus the Q Brain, not one workforce

1. Q Brain = single LangGraph answer graph, 7 nodes, linear: preflight, context_firewall, pause, retrieval, answer, action_prepare, approval_gate. [CO] packages/q-orchestrator/src/graph.ts:561-589. It compiles with a Postgres checkpointer: packages/q-orchestrator/src/checkpoint-store.ts:86 (BatchedPostgresSaver extends PostgresSaver, line 114); apps/q-api/src/main.ts:4034. MemorySaver exists for unit tests only (checkpoint-store.ts:241).
2. "Q Work" lanes = three more LangGraph graphs (lane, outreach, stand-in) with `interrupt()` waits and the same checkpointer. [CO] packages/q-orchestrator/src/work/lane.ts:833-851, outreach.ts:216-224, stand-in.ts:266-275 (ADR 0030).
3. Workforce jobs (lead Q plans, specialists execute) = plain TypeScript, NOT LangGraph. Durability comes from a Postgres work queue with leases, not checkpoints. [CO] packages/q-orchestrator/src/workforce/job-runner.ts:102-217; apps/q-api/src/composition/workforce/runner.ts:33-245; queue.ts:165-172, 307 (`max_attempts: 3`).
4. Standing-instruction engine = a separate 3,393-line engine with its own planner (`InstructionPlanV5Result`), fired by a 60 s in-process sweep in q-api. [CO] apps/q-api/src/composition/instructions/engine.ts (wc), planner.ts:1-60, apps/q-api/src/main.ts:2113-2127. It does NOT call `boundPlan`/`runJob`; it only files a job record for display (`workforceTracker`, jobs.ts:835-873; engine.ts:1491 comment). [CO]

Consequence [INF]: a fix to the workforce executors does not change standing-instruction behaviour or the Q Work lanes, and the reverse.

## 2. Role registry vs executors (verified against current code)

Advertised roster: 10 stored roles, `LEAD, OUTREACH, MANDATE_WATCHER, CONVERSATION, WRITER, REVIEWER, SCHEDULER, DOCUMENTS, RESEARCH, AD_HOC`. [CO] registry.ts:17-28; mirrored in contracts packages/contracts/src/q/workforce.ts:31-42.
The lead contract has a different 8-role set (`QAgentRole`, includes DILIGENCE, SCHEDULING, DISCOVERY). [CO] executors.ts:128-138 maps between them (SCHEDULING->SCHEDULER, DISCOVERY->MANDATE_WATCHER, DILIGENCE->AD_HOC "never stored").

| Role (executor name)               | Executor?                                                         | Evidence                                                                    |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CONVERSATION                       | YES                                                               | executors.ts:27-33; impl jobs.ts:321-487 (`conversation("REPLY")`)          |
| OUTREACH                           | YES                                                               | executors.ts:36-42; impl jobs.ts:219-266                                    |
| SCHEDULING (stored SCHEDULER)      | YES                                                               | executors.ts:45-51; impl jobs.ts:321-487 (`conversation("SCHEDULE")`)       |
| DISCOVERY (stored MANDATE_WATCHER) | YES                                                               | executors.ts:54-60; impl jobs.ts:198-213                                    |
| RESEARCH                           | CONDITIONAL, only when a research provider is composed            | executors.ts:67-73, 105; jobs.ts:274-314, 494                               |
| DOCUMENTS                          | YES where the document pipeline runs in JOB mode (2026-10-28)     | executors.ts `registeredExecutors` (`availability.documents`); jobs.ts      |
| DILIGENCE                          | YES, composed with DOCUMENTS (questions filed for approval)       | executors.ts `registeredExecutors` (`availability.diligence`); diligence.ts |
| WRITER, REVIEWER                   | NO as roles; run inside CONVERSATION/OUTREACH via `OutwardReview` | executors.ts:15-21; plan.ts:114-122 refuses them with NO_EXECUTOR           |
| AD_HOC                             | NO (spawning not implemented; `spawned: false` always)            | plan.ts:164; registry.ts:123-130                                            |
| LEAD                               | not a step                                                        | plan.ts:110-113                                                             |

STALE since the 2026-10-11 audit: "DOCUMENTS and DILIGENCE unregistered" no longer holds. Both are registered where q-api composes the document pipeline in JOB mode (main.ts `documents` / `diligence` getters). [CO 2026-10-28]
Not agents: executors are fixed code procedures, not LLM tool-use loops. Models are called only for plan, reply-read, review and redraft. [CO] models.ts:175-231. `step.tools` is only a gate (`has(step.tools, ...)`, jobs.ts:220, 325-331); the tool names do not drive any model tool call. [CO]
Agent "tools" are NOT q-tools ids. They are labels (`search_companies`, `list_messages`...) backed by the `WorkforcePorts` bag. [CO] jobs.ts:56-129; ports.ts:137-338. The only things a plan can ever permit are the 8 (9 with research) names in `EXECUTABLE_JOB_TOOLS`. [CO] jobs.ts:524-539.
Registry/executor drift: SCHEDULER role lists `schedule.reminder.create` and `email.send` (registry.ts:95-101) but the executor has only 3 tools (executors.ts:48). DOCUMENTS lists 4 tools that no plan can permit (not in jobs.ts:524-533). [CO]

## 3. Typed tools (packages/q-tools) and who gets them

- About 110 distinct tool-id constants under packages/q-tools/src/tools (53 files); my grep count is approximate. [INF] Catalogue assembled in default-tools.ts:92-200+ with optional tools gated on which ports are composed. [CO]
- Areas [CO from file names and ids]: company/investor reads (company.get, company.search, investor_mandate.get, fit._, discovery._), public web (public_web.search/extract, people._), relationships and chat (relationship._, chat.message.send), scheduling (meeting._, schedule._), documents (documents.own._, documents.brand._, documents.uploaded.list), data room and deck reads (company.data_room._, company.deck.read, deck.coaching.read), onboarding (onboarding._), client/UI actions (client._, 13 constants), work/delegation (q.errand.start, q.instruction.propose, q.work._, q.workforce.job.propose), settings, daily, email (relationship.email.propose, inbound_email.*), and tools generated from the app-action registry (tools/app-actions.ts:1-60), which includes `DILIGENCE_ACTIONS` (packages/app-actions/src/registry.ts:15,57).
- Q Brain gets this whole catalogue, filtered per run by the Context Firewall plan and entitlements (default-tools.ts:99-107; definition.ts:35-58). [CO]
- Workforce agents get NONE of it directly. They call app services through `WorkforcePorts` as the approver (`mine(owner)` check, ports.ts:143-148). [CO] So the typed-tool authorize/Zod pipeline is bypassed for the workforce's sends, bookings and interest expressions; those use app services directly (`services.sendChat`, ports.ts:~245). [CO]
- Five delegation tools are gated as `q.delegations`: PROPOSE_ERRAND, PROPOSE_Q_OUTREACH, PROPOSE_STAND_IN, PROPOSE_STANDING_INSTRUCTION, PROPOSE_Q_JOB. [CO] default-tools.ts:115-122. Only PROPOSE_Q_JOB feeds the workforce executors.

## 4. Planning constraints, budgets, retries

- Plan: one model call (`JOB_PLAN`, 1 attempt, cap $0.08, 2,000 tokens, 60 s). [CO] models.ts:70-75, 218-230.
- `boundPlan` refuses a step for: unknown role, LEAD, no executor, no permitted tool, waits on missing step, duplicate key, over budget, more than 12 steps. [CO] plan.ts:57-168 (MAX_JOB_STEPS=12 at :81).
- Any refused step invalidates the whole plan (`planIsValid`, plan.ts:185-189); board returns NOT_PLANNED. [CO] job-actions.ts:~436-446 (`planned.refused.length > 0`).
- Budget: DEFAULT_JOB_BUDGET_USD = 0.50 (jobs.ts:556); lead's $0.10 is subtracted (jobs.ts:608); each step costs a fixed per-role constant (registry.ts: OUTREACH/CONVERSATION 0.10, SCHEDULER/MANDATE_WATCHER 0.05). [CO] So roughly 4 CONVERSATION/OUTREACH steps fit; the 12-step cap is unreachable for those roles. [INF, arithmetic on CO constants]
- The budget is a PLAN-TIME SUM of constants, not measured spend. I found no runtime check of actual spend in `runJob` or `runOne` (grep "budget" in runner.ts/jobs.ts returns only plan/record sites). [CO by grep absence] Real limits are (a) per-call gateway caps: review/redraft $0.03, classify $0.005 (models.ts:58-69); (b) month cap checked only at job start: $60 default, `Q_WORKFORCE_MONTHLY_LIMIT_USD` (limit.ts:12-41, jobs.ts:655-682); a ledger read failure fails OPEN (limit.ts:36). [CO]
- Retries: queue claims up to 3 attempts (queue.ts:307); on throw the row is released and re-claimed (runner.ts:202-213); steps already DONE are not rerun, FAILED steps are rerun on resume (job-runner.ts:129-145). Model calls: 2 attempts for small calls (models.ts:58-63). Review loop: max 2 rounds (review-loop.ts:45-50, 306-309). No backoff or per-step retry policy. [CO]

## 5. Review and approval logic

- Human approval path: Q Brain `propose_q_job` prepares the plan as the card payload (q-job.ts:147-330; job-actions.ts:~395-500); the Approval Engine executes `WORKFORCE_JOB_START` on approval, which only files the job and enqueues it (job-actions.ts:330-370); a worker claims it under a lease (runner.ts:230). The approver is re-resolved at claim time; a person who lost access gets BLOCKED (runner.ts:102-111). [CO] Approval binds the whole plan; individual outward messages inside an approved job are NOT separately approved. They are sent if the reviewer passes. [CO] jobs.ts:443-451.
- Writer/reviewer loop: `writeWithReview` scores 6 criteria by fixed weights (review-loop.ts:24-31), four hard integrity rules (GROUNDED, NO_COMMITMENTS, NOTHING_PRIVATE, HONEST_IDENTITY, +RESPONDS_TO_THREAD, :115-121), threshold 75, one redraft. An integrity failure is never averaged away (:134). Near misses (within 10 points, code-clean) become an approval card for the person, never auto-sent (review.ts:88-92, 138-143). [CO]
- Reviewer unreadable / schema error vs policy: `models.call` returns `null` for ANY of: gateway error, non-structured output, Zod failure, thrown error (models.ts:161-172). `writeWithReview` converts `null` into HELD with reason `REVIEW_UNAVAILABLE` (review-loop.ts:319-329). So a technical or schema failure is persisted as a HELD draft with its own reason code, not as a policy hold, but it still withholds the message and surfaces as "needs you". Distinguishing it relies only on the reason code. [CO] The auto-recovery is narrow: `sweepStale` re-reviews REVIEW_UNAVAILABLE holds once, only from INSTRUCTION-sourced jobs (held-retry.ts:65-71, 116-139), and is called only from the wake-listener `catchUp` (main.ts:~4859-4867), i.e. on (re)connect, not on a schedule. Delegated-job drafts return NOT_SUPPORTED. [CO]

## 6. Document generation, data room and diligence

- Document Studio is real and substantial: `runDocumentPipeline` (write, design, find assets, check, fix twice, ready) in packages/q-specialists/src/company/document-pipeline.ts:617; studio helpers document-studio.ts; versioned artifacts and a Postgres document-job repo in packages/q-artifacts (index.ts:1-25; infrastructure/postgres-document-jobs.ts:40); PDF/PPTX export in packages/deck-render/src/export.ts:13-45. [CO]
- Wired ONLY to Q Brain tools (`documents.own.*`, q-tools/src/tools/documents.ts:35-39, 421; composed in apps/q-api/src/composition/artifacts.ts and documents.ts). The workforce has zero references: grep for document/artifact/diligence in apps/q-api/src/composition/workforce/_.ts and q-orchestrator/src/workforce/_.ts finds only comments, a `DOCUMENT` ask-kind in thread-consistency.ts:19-109 and a subject key (job-actions.ts:162). [CO]
- The reason text for DOCUMENTS ("nothing produces a durable, checkable file", executors.ts:86-87) looks STALE given the artifact service above. [INF]
- 2026-10-28: the two bullets above are stale. The workforce composes documents (documents.ts), analyses (analysis.ts), diligence memos (diligence-memo.ts, claims.ts) and diligence questions (diligence.ts). A diligence memo reads the data room through the same authorised view the chat tools use (material-documents.ts). [CO]
- Diligence actions exist as app-actions (diligence.document.share/revoke/request, request.fulfil/upload_fulfil, packages/app-actions/src/actions/diligence.ts:93-330), reachable by Q Brain (generated tools) and by meeting follow-up cards (apps/q-api/src/composition/meeting-follow-up-cards.ts:221), not by any workforce executor. [CO]

## 7. Proactive triggers

- Standing instructions fire on: cadence (default 4 h), approval, relationship events, chat message, new ready company; claims are DB-side so instances do not double fire. [CO] instructions/triggers.ts:7-14, 61-70. Outside working hours = deferred 30 min; failed firing retries after 10 min (triggers.ts:18-22).
- apps/workers does NOT run agents. It only projects events and wakes q-api via pg_notify: chat message handler (apps/workers/src/network/chat-message-handler.ts), readiness event -> `Q_INSTRUCTION_NEW_COMPANY_CHANNEL` (apps/workers/src/main.ts:~884-890; newly-ready-company.ts:1-33), plus startup-alert matching. [CO]
- Autonomy is off by default: `CQ_INSTRUCTIONS_AUTO !== "on"` means every AUTO step is asked (main.ts:~2131-2137). [CO]
- Workforce jobs themselves run from a 60 s-ish `agentWorkRunner.pass()` interval and a kick after approval (main.ts:4144-4162, 3441). There is no event trigger that creates a workforce job; jobs begin only from an approved Q Brain card. [CO]

## 8. User-facing Work experience

- /work page (apps/web/app/(app)/work/page.tsx) with views needs, progress, done, team, cost (page.tsx:~27-45), plus `/work/[delegationId]`. Loads workforce overview and last 6 jobs with cursor paging via q-api (apps/web/src/features/work/workforce-actions.ts:36-87). Components: work-page.tsx (1,917 lines), decision-queue.tsx, workforce-map/panel/section, workforce-cost. [CO]
- The Team roster ALWAYS shows 9 roles incl. DOCUMENTS ("Finds what they ask for") and RESEARCH ("Reads decks and the web"), plus WRITER and REVIEWER as peers. [CO] workforce-view.ts:49-71; workforce-agents.ts:347, 725. DOCUMENTS never runs; RESEARCH may not be registered; "reads decks" is not an executor capability. [CO]

## 9. Connection to Q Brain and GPT-Live voice

- Q -> agents: Q Brain delegates by a model tool `propose_q_job` (q-job.ts:264-330). It is "one per turn", checks existing waiting work first (job-actions.ts:~399-420) and returns a card; nothing runs until approval. [CO]
- Voice: GPT-Live voice has no direct agent access. Each voice delegation = ONE Q Brain run (voice/live/broker.ts:125-221). Its prompt tells the voice it can do "starting, checking and stopping research or drafting tasks that run in the background" (prompt.ts:81). A grep of apps/q-api/src/voice/live for workforce/propose_q_job returns nothing. [CO] So voice->workforce works only indirectly, with approval on screen.
- Agents -> Q (report back): PULL only. Held drafts and stopped jobs are read by Q through attention sources (apps/q-api/src/composition/attention-sources.ts:12-80, 239-245) and the person gets `ports.notify` notices (jobs.ts:367-377, 434-440). Nothing wakes a Q conversation or a live voice session when a job ends. [CO for pull; INF for no push, from absence in voice/live and graph code]
- Specialists in packages/q-specialists (delegation.ts:1-30 etc.) are Q Brain answer-path helpers, not workforce agents. [CO]

## 10. Specific defects / integration gaps

1. UI advertises agents that cannot run. workforce-view.ts:49-71 lists DOCUMENTS and RESEARCH (and WRITER/REVIEWER as agents); executors.ts:86-88,97-107 registers neither DOCUMENTS nor, unless a provider exists, RESEARCH. Failure: user sees a "Documents" teammate; a request for a deck can never be planned (plan.ts:125-129 NO_EXECUTOR), and Q answers NOT_PLANNED with no deck.
2. Document Studio is disconnected from the workforce. q-specialists/company/document-pipeline.ts:617 and q-artifacts exist, but no executor calls them (executors.ts:82-89). Failure: "send them our deck" or "prepare a one-pager then email it" cannot be a multi-step job. The DOCUMENTS unregistered reason is likely stale.
3. Diligence/data-room not delegable. diligence.document.share and request.fulfil (app-actions/src/actions/diligence.ts:93,262) are listed on the DOCUMENTS role (registry.ts:110-113) but absent from EXECUTABLE_JOB_TOOLS (jobs.ts:524-533) and there is no DILIGENCE executor (executors.ts:88). Failure: data-room requests need the person every time.
4. Budget is not enforced at run time. plan.ts:149 sums per-role constants; runJob (job-runner.ts:146-208) and runOne (runner.ts:74-217) never compare measured spend to `budgetUsd`; the month cap is checked only at job start and fails open (limit.ts:36). Failure: a job can exceed its stated $0.50, and a ledger outage removes the cap.
5. Fixed-cost budget makes real plans fail whole. jobs.ts:556,608 gives $0.40 for steps; registry.ts:61,75 prices 0.10 each. A plan with a fifth CONVERSATION/OUTREACH step gets OVER_BUDGET (plan.ts:149-152) and the whole plan is dropped (job-actions.ts:~436-446), so the person sees NOT_PLANNED, not a trimmed plan.
6. Technical reviewer failure is indistinguishable from "no good draft" at the model layer. models.ts:161-172 collapses gateway outage, schema failure and thrown errors into null; review-loop.ts:319-329 holds the draft. Recovery is startup-only and INSTRUCTION-only (held-retry.ts:65-71,116; main.ts:~4859-4867). Failure: a transient reviewer outage leaves delegated-job replies held until the person acts.
7. Executor errors are swallowed. job-runner.ts:198-201 `.catch(() => FAILED "This step failed; nothing was sent.")` with no logging or error code. Failure: root cause of a failed step is not recoverable from the run record.
8. No reply material for the workforce writer/reviewer. ports.ts:201-202 sets `material: ""`. The reviewer's GROUNDED rule (review-loop.ts:116) then has nothing the writer may state as fact. Failure [INF]: replies are generic or are held more often than standing-instruction replies, which pass `material` (instructions/material.ts).
9. DISCOVERY is not "newly matching". It returns the top 25 of the live feed every time (ports.ts:152-163; MAX_PER_STEP=25, jobs.ts:144), ignoring the step goal (jobs.ts:198-213). OUTREACH then expresses interest in up to 25 companies in one approved step (jobs.ts:229-244) with no per-company confirmation. Failure: a vague goal produces a mass interest blast under one plan approval.
10. Scheduling failures are silent. jobs.ts:385-394 ignores `result.ok === false` (no counter, no notify), and SCHEDULE step always returns DONE (jobs.ts:459-467). Failure: a failed booking reads as "No calls to book yet."; same for REPLY steps where replies are left for the person (`handed`) yet status is DONE (jobs.ts:484-486).
11. Three or four parallel engines with no shared contract: workforce (jobs.ts), standing instructions (instructions/engine.ts, own planner), Q Work lanes (q-orchestrator/src/work/*), errands. Each has its own plan schema, review hook and job-record plumbing. Failure: duplicate logic and inconsistent holds, approvals and cost accounting; the workforce page is a display layer joined by `ensureJob` records.
12. Agents do not use the typed tool system. Workforce acts through `WorkforcePorts` (jobs.ts:56-129), skipping q-tools authorize/Zod/entitlement gating (definition.ts, default-tools.ts:99-107). Failure: policy added to a q-tool (e.g. a new sensitivity rule) does not reach workforce sends; names in registry/executors are not validated against q-tools ids.
13. No push report-back to Q or voice. Job completion creates notices and attention rows only (attention-sources.ts:12-80). Failure: a live voice session cannot say "your Kestrel job just finished" unless the person asks; the voice prompt (voice/live/prompt.ts:81) promises background research tasks.
14. `prepared` plan cache is process memory (job-actions.ts, `new Map` in `createWorkforceJobBoard`). [INF] Prepare and propose occur in one run, so it works single-process, but a restart or second instance between tool call and proposal loses the card.
15. Registry/contract drift: 10-role stored enum (contracts/q/workforce.ts:31-42) vs 8-role QAgentRole, bridged by STORED_ROLE with DILIGENCE->AD_HOC (executors.ts:128-138), SCHEDULER tool list mismatch (registry.ts:95-101 vs executors.ts:48). Failure: any new role needs migration plus two enums plus UI maps (workforce-view.ts:49-71).

## 11. Suggested first three slices for Codex

1. Truth-in-roster + failure visibility (small, safe). Make the web roster (workforce-view.ts:49-71) and `/overview` read the registered executors from q-api, hiding or labelling DOCUMENTS/RESEARCH/WRITER/REVIEWER as unavailable; log and persist error class in job-runner.ts:198-201; count scheduling failures (jobs.ts:385-394). Tests in packages/q-orchestrator/test/workforce.test.ts.
2. DOCUMENTS executor over the existing pipeline. Register a DOCUMENTS executor whose port calls the artifact service (composition/artifacts.ts) to produce or find a deck/PDF and return the artifact id as step output; add `documents.own.*` equivalents to `EXECUTABLE_JOB_TOOLS`; keep sharing as a person-approved card (reuse diligence.document.share via the Approval Engine, not auto-send). Update the stale reason at executors.ts:86-87.
3. Real budget and reviewer-failure handling. Add a measured-spend check between steps using the usage ledger by `workforceCorrelationId` (job-runner recorder `prior`/new `spent` port; stop with HELD "budget reached"), replace per-role constant budgets or raise job default, and give `REVIEW_UNAVAILABLE` holds from any job source a scheduled auto re-review (held-retry.ts:65-71,116 plus an interval) with technical errors separated from policy holds in `models.call`.
