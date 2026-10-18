# Agent task execution: standing instruction firing (and workforce job)

These diagrams are drawn from the code at HEAD `520bd123`. The main source is `apps/q-api/src/composition/instructions/engine.ts`; cited lines are in `07-WORK-AND-AGENTS.md`. Nodes marked ⚠ are where a counterpart can be left unanswered.

```mermaid
flowchart TD
  T0[Trigger: 60s sweep main.ts:1892 / approval / chat wake / relationship wake / delegation on] --> C[claimDue: next_fire_at += cadence_minutes 240 BEFORE firing store.ts:345]
  C --> A{ACTIVE, not expired, grant valid?}
  A -- no --> X0[return NOT_ACTIVE/EXPIRED]
  A -- yes --> H{within working hours?}
  H -- no --> N0[NOTED once/day 'Waiting for your working hours'; defer 30 min]
  H -- yes --> ACT[actorFor: re-resolve person; people in scope]
  ACT --> R[Read up to 8 threads via quarantined reader under budget engine.ts:1884]
  R --> SUP[Supersede stale waiting cards F24]
  SUP --> Q{their question outside declared facts?}
  Q -- yes --> NQ[NEEDS_YOU notice + NOTED 'Passed question to you']
  Q --> RW[replyWaiting = matched, they wrote last, not declined, no waiting card]
  RW --> P[Planner INSTRUCTION_PLAN v8 STRUCTURED_EXTRACTION]
  P -- null --> PU[⚠ PLANNER_UNAVAILABLE: nothing recorded, no notice; next try +240 min]
  P --> V[validateStep per step: grant, scope, connection, messageProblem, consider, delegation, caps]
  V --> RP{refusals or waiting reply unanswered?}
  RP -- yes, attempts left --> P
  RP --> REV[Reviewer loop on each chat step: thread consistency + DRAFT_REVIEW v3; threshold 75; 2 rounds]
  REV -- PASSED --> VERD
  REV -- HELD within 10 pts, code-clean --> NEAR[ASK NEAR_THE_BAR card - recorded HELD in workforce D-03]
  REV -- HELD --> REF[REFUSED BELOW_THE_BAR]
  VERD{verdict} -- AUTO and CQ_INSTRUCTIONS_AUTO=on and reviewed --> RUN[authorize + run app action, idempotency key; DONE - not marked viaQ D-07]
  VERD -- AUTO but autonomy off or not reviewed --> CARD
  VERD -- ASK --> CARD[Approval Engine card app.action in instruction conversation]
  NEAR --> CARD
  VERD -- HOLD --> HN[NOTED only; no notice]
  REF --> WR
  CARD --> NY[NEEDS_YOU notice 'N things need your yes']
  CARD --> WAIT[⚠ card waits: no escalation; TTL 24h; lapsed card vanishes from Needs you but engine still holds ALREADY_ASKED D-01]
  RUN --> DONE[instruction_steps DONE -> Done for you]
  WR{waiting reply neither answered, carded nor held?} -- yes --> RWN[REPLY_WAITING step + NEEDS_YOU notice with refusal codes]
  WR -- no, and plan empty --> QUIET[⚠ NOTED 'nothing needs a reply right now' even when threads were unread D-04]
```

## Workforce job (propose_q_job → approval → run)

```mermaid
flowchart LR
  JP[propose_q_job tool] --> PL[JOB_PLAN v1 lead Q: 'every message written by WRITER and graded by REVIEWER']
  PL --> BP[boundPlan: keeps WRITER/REVIEWER steps with no tools]
  BP --> APR[Card q.workforce.job.start CONFIRM_REQUIRED]
  APR --> EX[execute: file job; void jobs.run - fire-and-forget D-08]
  EX --> RJ[runJob in order]
  RJ --> W{executor for role?}
  W -- WRITER/REVIEWER/DOCUMENTS/RESEARCH: none --> HD[HELD 'needs you'; dependants SKIPPED D-02]
  W -- MANDATE_WATCHER/OUTREACH --> EI[express interest in mandate matches]
  W -- CONVERSATION --> CV[read reply REPLY_READER; write brief '' ; review; send]
  CV -- held --> SIL[⚠ counted only; no notice D-09]
  W -- SCHEDULER --> BK[book first free slot]
```
