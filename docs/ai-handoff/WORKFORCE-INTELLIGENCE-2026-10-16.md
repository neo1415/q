# Workforce intelligence (lane wf, 2026-10-16)

Owner request: the existing workforce and Q orchestration should get better at
reasoning (goal, missing information, evidence-grounded plan, parallel work,
replanning, proactive next steps, explanations, progress, approval), without a
second workforce. This note maps what exists, names the gaps, and records what
this lane changed.

## Map (graphify AST graph over q-core, q-orchestrator, q-specialists, q-runtime, q-actions, q-knowledge, q-api composition: 5 858 nodes, 15 175 edges)

| Piece                 | Where                                                                                                                                                                      | What it does today                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead Q planner        | `JOB_PLAN` v4, `packages/q-core/src/prompts/tasks/workforce.v1.ts`; called by `apps/q-api/src/composition/workforce/models.ts` (`STRUCTURED_EXTRACTION`, 1 attempt, $0.08) | Reads **goal + roster + allowed tools** only. Returns summary, steps (role, tools, dependsOn, document), cannot.                                                                                                       |
| Plan bounding         | `packages/q-orchestrator/src/workforce/plan.ts` `boundPlan`                                                                                                                | Code keeps only registered executors, permitted tools, budget, known dependencies; a plan with any refused step is never offered.                                                                                      |
| Runner                | `packages/q-orchestrator/src/workforce/job-runner.ts` `runJob`                                                                                                             | Dependency-aware: independent steps run side by side, outward steps in plan order. A failed dependency SKIPS dependents. Resume via `prior`.                                                                           |
| Executors             | `executors.ts` registry; implementations in `apps/q-api/src/composition/workforce/jobs.ts`                                                                                 | CONVERSATION, OUTREACH, SCHEDULING, DISCOVERY, RESEARCH, DOCUMENTS (prepare / critique-and-revise), DILIGENCE (questions filed as a card).                                                                             |
| Proposal and approval | `propose_q_job` (`packages/q-tools/src/tools/q-job.ts`), `job-actions.ts`                                                                                                  | `goalSubjects` resolves the records the goal names by the person's reach; R5 checks waiting approvals; the plan is the card's exact payload (`q.workforce.job.start`, CONFIRM_REQUIRED).                               |
| Durable run           | `workforce/queue.ts` (`q_runtime.agent_work_queue`: plan + per-step results), `runner.ts`                                                                                  | Leased, resumable.                                                                                                                                                                                                     |
| Progress              | Work page `workforce/page.ts` (runs, hand-offs, drafts, grades, timeline); `list_q_work` `jobs` (review findings, diligence questions)                                     | Shows who did what; not the plan's goal, dependencies, why, or what comes next.                                                                                                                                        |
| Standing instructions | `apps/q-api/src/composition/instructions/engine.ts` + `INSTRUCTION_PLAN` v9                                                                                                | Separate per-firing planner for ongoing goals (lane N's meeting-goal, delegation-policy, message-quality). Unchanged here.                                                                                             |
| Delegated work        | ADR 0030 LangGraph lane/outreach/stand-in (`packages/q-orchestrator/src/work`)                                                                                             | Unchanged here.                                                                                                                                                                                                        |
| Learning              | `workforce/learning.ts`                                                                                                                                                    | Draft approve/edit/reject becomes a per-person "what worked" note through the Write Gate. Person-scoped: never crosses users or organisations.                                                                         |
| Relationship history  | `RelationshipBrief` (R1, `packages/contracts/src/http/relationship-brief.ts`), `relationships.brief` port                                                                  | The Network context's authorised, deterministic fold for the asker's side: state, milestones, messages, meetings, no-shows, whose move, open diligence requests, shared documents; each source says OK or UNAVAILABLE. |

## Gaps

1. **The planner plans blind.** It never sees the relationship history or the open obligations of who the goal names, so "prepare for diligence with X" cannot be grounded in what has happened with X. (`RelationshipBrief` already exists and is authorised; it was not given to the lead.)
2. **No typed goal model.** No intended outcome, no prerequisites or missing information, no per-step reason, no evidence references. The card and the Work page say what will happen, never why.
3. **No replanning.** A failed step only skips what waits on it. Approval binds to the exact plan, so a new plan cannot be invented after approval.
4. **Contradictions do not change behaviour.** The critique step finds CONTRADICTION / MISSING_INFORMATION issues, but later outward steps run as if nothing was found.
5. **No next-step pass.** When a job ends, nothing says what is now most valuable, or which of those needs the person's approval.
6. **Progress is a timeline, not a plan.** Neither the Work page nor `list_q_work` says "3 of 5 done, waiting on X, next: Y".

## What this lane changes (smallest strong version; no migration)

- **Situation** (`q-orchestrator/workforce/situation.ts`): code turns the `RelationshipBrief`s of the records the goal names (at most 3), plus the person's waiting approvals, into numbered facts `F1..Fn`. Unknown sources become explicit UNKNOWN facts, never "none". Read as the person through the existing authorised port, before any model call (Context Firewall). Company and person names in it are marked untrusted in the prompt.
- **JOB_PLAN v5** (ACTIVE; v4 DEPRECATED): reads the situation; returns `outcome`, `prerequisites` (MET / MISSING / UNKNOWN, blocking, evidence refs, the step that resolves it), per-step `why` + `evidence` + optional `fallbackFor`, and `nextActions` with evidence.
- **Grounding** (`goal-plan.ts`): code drops every evidence reference that is not a situation fact, and decides `needsApproval` for each next action from the tool's class, never from the model.
- **Contingency replanning inside the approval**: a step may be a fallback for an earlier step. It runs only if that step did not finish; whatever waited on the original accepts the fallback's result. The fallback is part of the approved plan, so nothing runs that the person did not approve.
- **Signals**: a step's typed outputs may raise CONTRADICTION / MISSING_INFORMATION / CHANGED. An outward step downstream of an unreconciled CONTRADICTION is HELD for the person ("contradictions coexist until reconciled").
- **Next-step pass** (`nextSteps`): deterministic over the situation, the plan, the step results and signals: the planner's grounded next actions, whose-move items the plan did not cover, reconciliations for contradictions, retries for failed work. Each carries its evidence and whether it needs approval.
- **Progress**: `planProgress` derives done / total, running, waiting-on and blocked steps from the queue's approved plan and results. Shown on the Work page job detail (`plan` block) and in `list_q_work`'s `jobs[].progress`.

## Not changed (on purpose)

The standing-instruction engine, the LangGraph delegated work, the reviewer loop, the Write Gate, the approval engine, and the tool grants. No new roles or executors.

## Safety properties added (each has a deterministic test)

- A fallback runs only when its step FAILED or was SKIPPED; never when that step is HELD for the person, and it inherits the contradictions its step rested on (`packages/q-orchestrator/test/workforce-intelligence.test.ts`).
- An outward step downstream of a CONTRADICTION signal is HELD with the reason; unrelated outward work still goes.
- Evidence references that are not situation facts are dropped and counted; MET without a fact becomes UNKNOWN; `needsApproval` comes from the tool's class.
- The situation is fenced as untrusted in the prompt; UNAVAILABLE sources are UNKNOWN facts, never "none".

## Evals

- Scripted (CI, no provider): `packages/q-evals/test/workforce-scenarios.test.ts` runs four scenarios (diligence prep, GateQ follow-up, founder round prep, contradiction mid-task) through the real engine and scores plan quality and completion (`packages/q-evals/src/workforce/grade.ts`). A deliberately weak plan scores under 50.
- Live (not CI): `node scripts/evals/q-workforce/run.mjs --only='diligence|round'` asks the deployed q-api as the fictional accounts, grades the proposed card's plan on the same expectations, and reports the gateway calls and cost from `ai_ops.model_usage`. Capped at 10 calls (`MAX_CALLS`). Needs the release of this branch: production still runs JOB_PLAN v4 until then.

## Not done here

- Plan-level learning (a rejected plan or a dismissed next action teaching the lead) — the existing per-person draft learning through the Write Gate is unchanged.
- Replanning that writes a new plan after approval: by design a new plan is a new card; recovery inside an approval is the fallback mechanism.
