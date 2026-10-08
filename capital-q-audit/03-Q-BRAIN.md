# 03 — Q's AI Brain (investigator B)

Repository `/home/user/q`, branch `recovery/2026-09-12-8y2j4w`, HEAD `520bd123`. Read-only audit, 2026-10-08.
Classification legend: IMPLEMENTED / PARTIAL / CONFIGURED-UNUSED / MOCKED / BROKEN / UNTESTED / PLANNED.
Evidence excerpts are under `evidence/brain/` (named in brackets).

**Scope notes.** I read the text path end to end: HTTP route, orchestrator graph, the answer seam in `answer.ts`, the conversational answer in `model-gateway/src/q/index.ts`, the turn reader, the firewall's evaluation, the tool registry and executor, the prompt renderer, and the active prompt registry. I did **not** read these in detail: the voice routes (`apps/q-api/src/voice/*`, the duplex broker), the memory learner implementation, the workforce/review loop, the rehearsal twin, the onboarding interview agent, the welcome conductor, `ai_ops.model_usage` writers, the gateway's routing policy and provider tables (`packages/model-gateway/src/policy`, `providers`), or `hand-over.ts` / `references.ts` internals. Where this report depends on those, it says so.

---

## 1. Top-level architecture: one runtime path, many model calls

```
POST /v1/q/runs (apps/q-api/src/http/q-runs.ts:111)
  -> qRuntime.createRun (RECEIVED, idempotent)                      q-runs.ts:121
  -> orchestrator.start(...) detached, fire-and-forget               q-runs.ts:134-143
  -> room.watchRun (publishes the answer to the person's Q room)     q-runs.ts:145-152
  <- 202 RECEIVED + Location header                                  q-runs.ts:156-162

LangGraph graph (packages/q-orchestrator/src/graph.ts:481-509)
  preflight_gate -> context_firewall -> pause_seam -> retrieval_seam -> answer_seam
                         | DENIED -> END                 | DENIED -> END     | ANSWERED
                                                                        action_prepare -> approval_gate (interrupt)
```

- **One orchestrator for typed runs.** `createLangGraphQOrchestrator` (`orchestrator.ts:130-472`), wrapped `withLearning(..., memoryLearner)` (`apps/q-api/src/main.ts:3786-3799`). `pausePolicy: neverPause` (`main.ts:3795`), so the pause node never interrupts in production. CONFIGURED-UNUSED.
- **The answer seam is two layers.** `composeQIntelligence` (`apps/q-api/src/composition/q-intelligence.ts:273-556`):
  - `createSpecialistQAnswer` (`packages/q-specialists/src/answer.ts:729`) is the outer seam. It holds the turn reader, the code-run hands (navigation, page, screen acts, app actions, hand-over, delegation, profile gaps, pending decisions) and the Company Intelligence specialist.
  - `createModelGatewayQAnswer` (`packages/model-gateway/src/q/index.ts:1501`) is the **delegate**. It is the conversational analyst with a tool loop, and it answers the large majority of turns.
- **Every typed message is a new run.** The web calls `createQRun` with `conversationId` (`apps/web/src/features/q/actions.ts:202-340`). `POST /v1/q/runs/:id/messages` stores a message and **never answers it** (`q-runs.ts:195` comment "Stored, not answered. Nothing replies until an orchestrator exists."). CONFIGURED-UNUSED or dead path.
- **The firewall decides scope before anything is read.** `contextFirewall` node (`graph.ts:272-289`), revalidated before retrieval (`graph.ts:306-350`). See section 5.
- **Stream.** Answers are durable as a `q_runtime.conversation_messages` row plus a `q.message.completed` run event in **one transaction** (`answer.ts:876-913`, `index.ts:2835-2898`). Live sentence deltas go out via `deltas.publish` (`index.ts:2634-2665`). `pg_notify` wakes readers on commit (`postgres-q-runtime-repositories.ts:664-666`). Stages arrive as `q.stage.changed` events (`answer.ts:854-873`).

[evidence: `http-q-runs.md`, `orchestrator.md`, `orchestrator-graph-a.md`, `orchestrator-graph-b.md`]

### 1.1 The per-turn decision ladder inside `answerTurn` / `answerTurnRead`

In order (`answer.ts:1960-3067`), with the first match ending the turn:

| #   | Step                                                                                                 | Model?                     | Code                                   |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- |
| 0   | `delegate.warm(request)`: prefetches history, context, tools, memory and own facts in parallel       | no                         | `answer.ts:1967`, `index.ts:2197-2209` |
| 1   | Load history (64), latest USER line                                                                  | no                         | `answer.ts:1973-1980`                  |
| 2   | Start a pending-decision read for a waiting card (DECISION_READER), speculative and in parallel      | yes                        | `answer.ts:2002-2026`                  |
| 3   | `screenActOf` regex (scroll, top, bottom, back) gives a `UI_INTENT SCREEN_ACT`                       | no                         | `answer.ts:2187-2199`, `3354-3390`     |
| 4   | `pageAnswer`: an ordinal card on screen ("the third company") or a page by name from the route table | no                         | `answer.ts:2204-2211`, `1604-1676`     |
| 5   | Voice speculation: a spoken turn's answer starts under a default reading                             | yes (analyst)              | `answer.ts:2224-2267`                  |
| 6   | **TURN_READER v44**: early prereading is reused, then retried once on failure                        | yes                        | `answer.ts:2268-2314`                  |
| 7   | **heardAs** (spoken only): inserts the likely words as a new USER line and re-runs `answerTurn`      | no (recursion)             | `answer.ts:2345-2378`                  |
| 8   | Pending decision concluded: a REPLY line ends the turn                                               | (from 2)                   | `answer.ts:2383-2401`                  |
| 9   | `earlierNotForQ` and `addressedToQ=false` lines are marked and **not answered**                      | no                         | `answer.ts:2410-2437`                  |
| 10  | **UNCLEAR_TRANSCRIPT**: spoken gives **SILENT**; typed gives one prompt, then silence                | no                         | `answer.ts:2442-2463`                  |
| 11  | Reference: `openReferenced` (one record) or `repeatLastAction` ("try again")                         | no / small                 | `answer.ts:2470-2498`                  |
| 12  | `saveToOwnProfile`: profile gaps filled by code                                                      | yes (PROFILE_GAP_READER)   | `answer.ts:2526-2549`                  |
| 13  | Hands: NAVIGATE, SET_VISIBILITY, PREPARE_DOCUMENT through `actOnTool`                                | no                         | `answer.ts:2572-2598`, `1447-1535`     |
| 14  | A declared action waiting on a reply continues                                                       | yes (APP_ACTION_ARGUMENTS) | `answer.ts:2611-2666`                  |
| 15  | App action named, or routed (APP_ACTION_ROUTER), runs with its arguments; one retry                  | yes                        | `answer.ts:2667-2857`                  |
| 16  | Hand-over (meeting, take over) or delegation (standing instruction)                                  | maybe                      | `answer.ts:2862-2899`, `2734-2749`     |
| 17  | Question series step, readiness lead, ownRecords flag, tool focus                                    | no                         | `answer.ts:2903-2987`                  |
| 18  | Speculation adopted, or `answerOnce`                                                                 | yes                        | `answer.ts:3035-3038`                  |
| 19  | `answerOnce`: the specialist `supports()`, else the **delegate**                                     | yes                        | `answer.ts:3069-3117`                  |

**Classification:** IMPLEMENTED, and very heavily patched. The ladder is about 1,100 lines of conditionals, each dated to a live incident. Order-dependent interactions are the main correctness risk.

---

## 2. The 13 traced interactions (text unless noted)

Shared prefix for all typed turns: route `q-runs.ts:111` → `orchestrator.start` `orchestrator.ts:334-395` → `preflight` `graph.ts:238-266` (fires `answer.preread`, an early turn reading, `answer.ts:1775-1822`) → `contextFirewall` `graph.ts:272-289` → `pause` (never) → `retrieve` `graph.ts:306-350` (`qIntelligence.retrieval` = `evidence.port`, `q-intelligence.ts:546-548`) → `answerNode` `graph.ts:355-397` → `answerTurn` `answer.ts:1960`. A run ends in `execute()` at `orchestrator.ts:189-250`. ANSWERED becomes COMPLETED.

### 2.1 Greeting ("hi Q")

1. The firewall plans with no subjects. `deriveTaskClass` gives `GENERAL_QUESTION` (`purpose.ts:73-75`). Actor-wide scopes include `GENERAL_MODEL_KNOWLEDGE` and `OWN_ONBOARDING` (`purpose.ts:162-176`). **No founder or investor role is required.**
2. `screenActOf`: strips "hi q" and stops. No match (`answer.ts:3362`). `pageAnswer` → null.
3. TURN_READER gives `SMALL_TALK` (template line 17 in `prompts-active-texts.md`).
4. No hand applies, so the turn reaches `answerOnce` → `specialist.supports()` false (no company) → `delegate.answer` (`answer.ts:3105-3111`).
5. Gateway `answer()` assembles about 12 prefetched own facts (standing, day, onboarding …) and renders `COMPANY_ANALYST v21` (`index.ts:2538-2555`). It makes one model call with tools offered (`index.ts:3229-3250`). `NEXT_STEP_NOTE` says "no offer when they are just chatting" (`index.ts:801-802`).
6. `persistAnswer` → message + `q.message.completed` (`index.ts:4160-4175`).

**Observation:** even a greeting pays for a turn-reader call, all prefetch tool reads (own standing, own day: `list_schedule`, `list_pending_approvals`, `list_q_work`), and a tool-bearing analyst call with up to 127 tools offered (`registry.ts:32`, `MODEL_TOOLS_MAX = 128`). There is no cheap small-talk short path. PARTIAL, for cost and latency.

### 2.2 Factual question ("who is the president of Nigeria?")

Same path as 2.1. The reader gives `QUESTION_TO_Q` / `PUBLIC_FACTS` or `REAL_WORLD_EXAMPLE`. `researchDirectiveFor` (q-core, not inspected in detail) sets the research mode (`answer.ts:2315-2322`). The gateway adds `GENERAL_KNOWLEDGE_NOTE` only when the plan holds `GENERAL_MODEL_KNOWLEDGE` (`index.ts:2514-2516`, `734-735`). It does for any non-CLASSIFY capability (`purpose.ts:167-175`). TOOLS_FIRST_NOTE pushes "what is current … is looked up, never answered from memory" (`index.ts:501`). IMPLEMENTED.

### 2.3 Web research ("check the web for recent funding in Lagos fintech")

1. The reader gives `RESEARCH_REQUEST`. The directive mode is EXPLICIT (`answer.ts:2315-2322`).
2. Gateway: `research_public_web` stays offered unless the mode is `NEVER` without fallback (`index.ts:2350-2355`). `RESEARCH_NOTE` is added (`index.ts:665-666`).
3. Tool loop round 1: the model proposes `research_public_web`. The executor validates input, actor and plan, then runs `authorize` and the sensitivity check (`executor.ts:148-330`). Sources are collected (`index.ts:3072-3105`).
4. If the model answered without searching and `researchHopDue()` is true, the code runs a forced research hop (`index.ts:3000-3023`, `3640-3662`). After web content, no further tool round is allowed (`index.ts:3210-3213`).
5. A final structured call follows if needed (`index.ts:3673-3683`). `PUBLIC_SOURCE` blocks are attached (`index.ts:2855-2861`).

For a **company** subject on an INVESTIGATE or ASSESS run, the specialist path is used instead, with `publicResearch: directive.mode === "EXPLICIT"` (`answer.ts:3122-3130`). IMPLEMENTED. The research provider and its live calls were not inspected.

### 2.4 Own profile ("what do you know about me?")

The reader gives `QUESTION_TO_Q` / `THEIR_OWN_RECORDS`, so `ownRecords = true` (`answer.ts:2934-2936`), which forces the delegate even with a company subject (`answer.ts:3107`). The gateway prefetches:

- own onboarding facts, if the `OWN_ONBOARDING` scope is granted (`index.ts:2111-2131`);
- own mandate for an investor (`index.ts:1738-1757`);
- own standing (`list_my_relationships`, `index.ts:1697-1706`);
- own readiness via `read_my_record MARKETPLACE_READINESS` (`index.ts:2431-2465`).

It also adds `OWN_MANDATE_NOTE` (`index.ts:3170-3172`). A founder's asker line comes from `askerOf` (`main.ts:3700-3713`). IMPLEMENTED.

### 2.5 Founder asking about investors ("which investors fit us?")

No investor subject is present, so the turn reaches the delegate. Tools are focused by `toolFocusOf` (`answer.ts:2949-2967`); `investor.prospects` is among them (inferred from `index.ts:2964`). With fewer than 3 prospects (`PROSPECT_RESEARCH_BELOW`, `index.ts:558`), `prospectsThin` makes code read the public web and add `PROSPECT_RESEARCH_NOTE` (`index.ts:564-567`, `3016-3017`). A named investor organisation subject plans as `INVESTOR_QUESTION` (`purpose.ts:79-81`) with `INVESTOR_PROFILE` / `INVESTOR_MANDATE` candidates. Whether a founder may see another fund's mandate is the permission layer's call; I did not inspect `catalogue.ts` rights. PARTIAL / not fully traced.

### 2.6 Investor asking about a company (on Discover, the company on screen)

1. `screen.companyId` is resolved by the firewall or dropped (contract comment `packages/contracts/src/q/request.ts:80-87`). As a subject it gives `COUNTERPARTY_COMPANY_QUESTION` (`purpose.ts:84-86`).
2. `answerOnce`: if `specialist.supports(probe)` and a COMPANY subject is present, Company Intelligence investigates (`answer.ts:3112-3148`). Otherwise the delegate prefetches `get_company` and `get_relationship` for the counterparty (`index.ts:1787-1810`, `2004-2033`).
3. Guards: `withoutRecommendationClaims` (`answer.ts:3163-3175`, `index.ts:3727-3743`) and fit numbers only from fit tools (`index.ts:3058-3070`). Analyst blocks are attached (`answer.ts:3261-3285`).

IMPLEMENTED. The specialist's `supports()` rule (`company/specialist.ts:367+`) was not read.

### 2.7 Recommendation ("top three companies for my mandate")

- Investor plus a fit question: `fitSweepAsk(latest.content)` starts a code-computed fit sweep in parallel (`index.ts:1714-1734`). If fits come back, the answer is **cards plus a templated summary with no model round** (`index.ts:2903-2951`).
- Otherwise the analyst fills `answerCards` (template "Lists, scores and comparisons go in answerCards"). The recommendation guard keeps only claims backed by `recommendation.explanation` or fit tools (`index.ts:3025-3070`).

The "feed ranking" path itself is deterministic elsewhere and not inspected. IMPLEMENTED (sweep path), PARTIAL (free-text recommendations depend on the model plus guards).

### 2.8 Real action, Prepare → Approve → Execute ("express interest in Ajopot")

1. The reader gives `TOOL_REQUEST` with `askedAction` / `appAction` = `propose_express_interest` (template lines 43-44).
2. `answer.ts:2667-2813`: `appActions.run(request, action)` calls the tool through the registry and executor. `authorize` resolves the company by id or name and checks `mayExpressInterest` (`packages/q-tools/src/tools/relationships.ts:574-601`). `execute` calls `relationships.prepareForApproval` (`relationships.ts:602-614`). That writes an **in-memory per-run proposal board**, one proposal per run (`apps/q-api/src/composition/profile-change-board.ts:186-234` is the same pattern).
3. `saidByAction` → `preparedForEngine` returns ANSWERED with `messageId: null` (`answer.ts:1753-1773`).
4. Graph `action_prepare` → `qActionPort.prepare` → `chainProposers(...)` takes the board entry (`main.ts:3252-3281`). The Approval Engine persists the action, the approval request and `AWAITING_APPROVAL` in one transaction (graph comment `graph.ts:52-58`, node `404-433`).
5. `approval_gate` calls `interrupt(Q_APPROVAL_PAUSE)` (`graph.ts:446`), and the orchestrator records `awaiting_approval` (`orchestrator.ts:191-197`).
6. Approval comes from the card, or from a typed or spoken "yes" in a later run. The later run's `pendingDecisions` (DECISION_READER plus turn reading, `pending-decision.ts:459-626`) calls `port.approve`, then `createApprovedContinuation` resumes the paused run (`main.ts:3803-3807`). `orchestrator.resume` moves AWAITING_APPROVAL → ACTION_EXECUTION (`orchestrator.ts:397-458`). `actions.executeApproved` re-verifies the approval, payload hash, permission and idempotent claim (`graph.ts:448-467`).
7. A sweep every few minutes executes approved but unexecuted actions (`main.ts:3811-3827`).

IMPLEMENTED. Note that the model is told "Tools only read." (`index.ts:956`) while `propose_*` tools are `SIDE_EFFECT` (`relationships.ts:563`) and `CAPABILITIES_NOTE` says Q prepares changes (`index.ts:695`). The model receives contradictory instructions (defect B-07).

### 2.9 Correction or interrupt ("no, I meant Wednesday" / "stop")

- **Correction:** the reader gives `CORRECTION`. A waiting declared action continues with merged arguments (`answer.ts:2615-2666`). Otherwise the turn reaches the analyst. Template rule: "A figure the person corrected, now or earlier … is current as theirs" (COMPANY_ANALYST, ACTING section). There is **no code-level correction store**; correction depends on the analyst re-reading conversation history and on memory recall (section 05).
- **Interrupt or cancel:** `POST /v1/q/runs/:id/cancel` (`q-runs.ts:207-220`) → `cancelRun` makes the run `CANCEL_REQUESTED`. Each graph boundary throws `QCancellationSignal` (`graph.ts:196-213`), and the engine signal reaches the model call (`graph.ts:370-382`). CONTROL turns ("pause", "carry on") are a reader kind (template line 19). Their handling past the reader was not traced. "Wasn't talking to you" gives `earlierNotForQ`, and earlier lines are marked `NOT_ADDRESSED_TO_Q` (`answer.ts:2410-2425`, `1825-1853`).
- A question series STOP is handled by `stepQuestionSequence` (`answer.ts:2903-2917`).

IMPLEMENTED (cancel), PARTIAL (correction is model-dependent).

### 2.10 Follow-up ("tell me more about it")

History is read for the **conversation**, not the run: 64 newest messages (`answer.ts:3080-3085`, `index.ts:1606-1611`). The analyst receives all earlier messages (up to 63) as `conversation` (`index.ts:2495-2499`). The turn reader sees the last 6 turns, each cut to 400 chars (`turn-reader.ts:269-272`). Its own companies named in the latest line or the last Q reply are prefetched (`index.ts:1818-1854`). IMPLEMENTED. See 05 for the windows.

### 2.11 Ambiguous question

- **Reader confidence LOW:** no hand, reference or app action fires (`answer.ts:2471`, `2504-2511`, `2805`). The turn reaches the analyst, which "asks one short question" per the reader template line 74. The analyst may set `clarifyingQuestions` (≤3).
- If the screen shows a subject and the analyst asks "who do you mean?", a re-round with `screenSubjectNote` tells it to act on the screen subject (`index.ts:533-549`, `3328-3362`).
- Typed `UNCLEAR_TRANSCRIPT`: one prompt, then silence (`answer.ts:2442-2463`).

IMPLEMENTED.

### 2.12 Switching between chat and task

There is no explicit mode. Each turn is re-read independently. A task (hand, app action, document) is chosen per turn by reader output. "Yes" to Q's own offer is read as the offered request (template line 13), and tool focus carries over for a "yes" (`answer.ts:2937-2967`, `focuses` map). A question series (`sequences` map) suppresses `NEXT_STEP_NOTE` (`index.ts:1013-1017`). Pending declared actions survive in Postgres (`createPostgresAwaitingActions`, `q-intelligence.ts:460`). Focus, sequence and last action are **in-process only** (`answer.ts:749-822`, `1679-1717`), so a restart or a second instance loses the task thread (defect B-02). PARTIAL.

### 2.13 Unauthorized request (investor asks for a private company's financials; or a subject they cannot reach)

- An **explicit subject** that does not resolve for the actor denies the **whole run** (`firewall.ts:653-667`). An entity subject with no organisation context also denies (`firewall.ts:640-651`). If no scope survives, the run is denied (`firewall.ts:749-765`).
- Graph → END. The orchestrator calls `runtime.fail(ref, "POLICY_DENIED")` (`orchestrator.ts:205-210`). The public message is the fixed sentence "I don't have information I can use to answer that in your current access context." (`packages/contracts/src/q/failure.ts:110-111`, `170`).
- Screen entities are "resolved for the asker or dropped silently" (contract comment `request.ts:80-87`), so a screen-only reference degrades to no subject rather than a denial. I did not verify where that dropping happens.
- Inside a run, tool calls beyond the plan are DENIED by the executor (`executor.ts:149-161`, `249-279`). The model learns only a code and a safe sentence. Founder-private data is gated by plan scopes and per-tool `authorize`.

IMPLEMENTED (deny-closed). UX: the denial is a run failure, not a conversational explanation.

---

## 3. Prompts

### 3.1 Active prompt versions

From the built registry (`packages/q-core/dist`; `turn-reader.v44.js` present, which matches source). There are 196 definitions in total and **54 ACTIVE**. Charters have no task class.

| id                            | v      | task class                    |     | id                         | v      | task class            |
| ----------------------------- | ------ | ----------------------------- | --- | -------------------------- | ------ | --------------------- |
| Q_SYSTEM (charter)            | 2      | –                             |     | INVESTOR_PERSONA           | 6      | STRUCTURED_EXTRACTION |
| Q_SYSTEM_VOICE (charter)      | 3      | –                             |     | INVESTOR_RESEARCH_READER   | 1      | STRUCTURED_EXTRACTION |
| APP_ACTION_ARGUMENTS          | 1      | FAST_CLASSIFICATION           |     | INVESTOR_TWIN_TURN         | 10     | NORMAL_DIALOGUE       |
| APP_ACTION_ROUTER             | 1      | FAST_CLASSIFICATION           |     | JOB_PLAN                   | 1      | STRUCTURED_EXTRACTION |
| ARTIFACT_REVISION             | 3      | NORMAL_DIALOGUE               |     | MEETING_CAMERA_NOTE        | 1      | STRUCTURED_EXTRACTION |
| BRIEFING_COMMAND              | 1      | STRUCTURED_EXTRACTION         |     | MEETING_HOST_TURN          | 3      | NORMAL_DIALOGUE       |
| CLAIM_EXTRACTION              | 1      | STRUCTURED_EXTRACTION         |     | MEETING_NOTES              | 3      | STRUCTURED_EXTRACTION |
| **COMPANY_ANALYST**           | **21** | EVIDENCE_SYNTHESIS (declared) |     | MEETING_OUTCOME_READER     | 1      | FAST_CLASSIFICATION   |
| DAILY_Q_TAKE                  | 1      | EVIDENCE_SYNTHESIS            |     | MEETING_SCREEN_NOTE        | 1      | STRUCTURED_EXTRACTION |
| DAILY_STORY_WRITER            | 1      | STRUCTURED_EXTRACTION         |     | MEMORY_EXTRACTOR           | 2      | STRUCTURED_EXTRACTION |
| DECISION_READER               | 2      | FAST_CLASSIFICATION           |     | ONBOARDING_MOVE_READER     | 1      | FAST_CLASSIFICATION   |
| DECK_EXTRACTION               | 1      | STRUCTURED_EXTRACTION         |     | PREFERENCE_POLARITY        | 1      | FAST_CLASSIFICATION   |
| DELEGATION_READER             | 5      | FAST_CLASSIFICATION           |     | PRESENCE_READER            | 1      | STRUCTURED_EXTRACTION |
| DILIGENCE_DOCUMENT_SUMMARY    | 1      | STRUCTURED_EXTRACTION         |     | PROFILE_GAP_READER         | 1      | STRUCTURED_EXTRACTION |
| DOCUMENT_CRITIQUE             | 1      | STRUCTURED_EXTRACTION         |     | REHEARSAL_SCORE            | 5      | STRUCTURED_EXTRACTION |
| DOCUMENT_POLISH               | 2      | NORMAL_DIALOGUE               |     | REPLY_READER               | 1      | FAST_CLASSIFICATION   |
| DRAFT_REDRAFT                 | 3      | STRUCTURED_EXTRACTION         |     | SPOKEN_REPLY               | 1      | FAST_CLASSIFICATION   |
| DRAFT_REVIEW                  | 3      | STRUCTURED_EXTRACTION         |     | **TURN_READER**            | **44** | FAST_CLASSIFICATION   |
| ERRAND_REPLY                  | 1      | STRUCTURED_EXTRACTION         |     | UTTERANCE_CHECK            | 1      | FAST_CLASSIFICATION   |
| FIT_EXPLANATION               | 1      | NORMAL_DIALOGUE               |     | WELCOME_CONDUCTOR          | 2      | NORMAL_DIALOGUE       |
| FIT_Q_VIEW                    | 1      | NORMAL_DIALOGUE               |     | WORK_CONVERSE              | 2      | STRUCTURED_EXTRACTION |
| FOUNDER_ONBOARDING_EXTRACTION | 2      | STRUCTURED_EXTRACTION         |     | WORK_INTERVIEW_REPORT      | 1      | STRUCTURED_EXTRACTION |
| FOUNDER_RESEARCH_READER       | 1      | STRUCTURED_EXTRACTION         |     | WORK_INTERVIEW_TURN        | 1      | STRUCTURED_EXTRACTION |
| GATEQ_INTERVIEWER             | 1      | NORMAL_DIALOGUE               |     | WORK_SHORTLIST             | 1      | STRUCTURED_EXTRACTION |
| INSTRUCTION_PLAN              | 8      | STRUCTURED_EXTRACTION         |     | WORK_SLOT_READER           | 1      | STRUCTURED_EXTRACTION |
| INSTRUCTION_THREAD_READER     | 3      | STRUCTURED_EXTRACTION         |     | WORK_STAND_IN_REPLY        | 2      | STRUCTURED_EXTRACTION |
| INTERVIEW_AGENT               | 16     | NORMAL_DIALOGUE               |     | INVESTOR_MANDATE_SYNTHESIS | 3      | STRUCTURED_EXTRACTION |

The registry enforces a single ACTIVE version per id (`packages/q-core/src/prompts/registry.ts:306-312`).

Full sanitized texts of Q_SYSTEM v2, Q_SYSTEM_VOICE v3, COMPANY_ANALYST v21 and TURN_READER v44 are in `evidence/brain/prompts-active-texts.md`.

### 3.2 Assembly (`renderPrompt`, `packages/q-core/src/prompts/renderer.ts:126-210`)

- The charter (`Q_SYSTEM` by default, or `Q_SYSTEM_VOICE`) is rendered with the frame `{operatingMode, communicationProfile, communicationGuidance, environmentNotes}` and becomes **one SYSTEM message**.
- The task template is rendered with the frame plus variables and becomes **one USER message** (`renderer.ts:197-200`).
- `renderTemplate` validates variables against the definition's Zod schema and refuses undeclared or unrendered tokens. **Untrusted variables are fenced** between `<<<UNTRUSTED_CONTENT source="…">>>` and `<<<END_UNTRUSTED_CONTENT>>>`, with fence neutralisation (`definition.ts:247-322`).
- `communicationGuidance` is rendered from the communication profile plus optional etiquette guides, capped at 4,000 chars (`renderer.ts:142-155`, `100-101`).
- The bundle identity is `q-system.v2_company-analyst.v21_comm.vN` plus a sha256 (`renderer.ts:185-195`). It is persisted on the run as `promptBundleVersion` (`orchestrator.ts:219-223`).
- **Conversational answer specifics** (`index.ts:2469-2555`):
  - `operatingMode` comes from `operatingModeForCapability`: ANSWER gives **DEBRIEF** (`index.ts:385-398`).
  - `environmentNotes` is split by `environmentNoteParts` into **standing** (charter, cache-stable) and **turn** (the `{{turnNotes}}` tail), bounded at 9,000 chars. Research guidance and the steady notes yield first (`index.ts:903-1063`).
  - After the rendered two messages, code appends the SYSTEM messages `capabilityNote(...)`, optional `Q_WORK_LINE` and `TOOLS_FIRST_NOTE` (`index.ts:3144-3147`), plus `OWN_MANDATE_NOTE` when own facts exist (`3170-3172`).
  - Re-rounds append `ASSISTANT` + `SAY_DO_NOTE` / `screenSubjectNote` (`3337-3348`), tool results (`toolResultMessage`), `fetchedForYouMessage`, `PROSPECT_RESEARCH_NOTE` and `SOURCE_CHANGE_NOTE` (`3652-3672`).
- **Turn reader:** Q_SYSTEM charter in ASSESSMENT mode, default profile, environment note "You classify one turn and nothing else…" (`turn-reader.ts:282-290`).

### 3.3 Structured outputs, validation, retries

- **Analyst:** schema `CompanyAnalystV17ResultSchema`, with `invalidListItems: "DROP"` and `lenientFields` = actionTalk, recommendation, answerCards, comparisonCards (`index.ts:514-520`, `2729-2743`). OpenAI receives the schema beside the tools; Gemini and Groq get tools only, with the shape left to the prompt (comment `index.ts:3233-3241`).
- A tool round that returns INVALID_MODEL_OUTPUT is retried once as TEXT with the tools kept, then answered without tools (`index.ts:3251-3281`). TEXT output is accepted through `acceptStructuredOutput` (`3385-3392`). Otherwise a final structured call is made (`3673-3683`).
- **Salvage:** if the final object fails validation after sentences were streamed, the heard prose is stored as the answer and `UNPREPARED_CHANGE_LINE` is added if a change was implied (`index.ts:4238-4316`).
- **Gateway budgets per task class:** `maxAttempts: 3` (`index.ts:401-455`). The turn reader uses 2 attempts, a 6 s timeout and 1,200 output tokens (`turn-reader.ts:109-114`). The answer seam retries the reader once more on null (`answer.ts:2305-2314`), so a turn reader can make **up to 4 model attempts**.
- **Text guards on output:** `withoutActionTalk`, `stripEmptyPromises`, `withoutPublicSourceLabels`, `citeAuthorisedFacts`, `inFirstPerson`, `withOneCaveat`, `withoutRecommendationClaims` (`index.ts:3703-3743`), applied per streamed sentence too (`2677-2727`), plus a screen-claim guard.

### 3.4 Task-class routing

`taskClassForCapability`: ANSWER → NORMAL_DIALOGUE, INVESTIGATE → DEEP_INVESTIGATION, ASSESS → EVIDENCE_SYNTHESIS, COMPARE → COMPARISON, CLASSIFY → FAST_CLASSIFICATION, PREPARE_ACTION → STRUCTURED_EXTRACTION (`index.ts:365-382`). The prompt's declared `taskClass` (COMPANY_ANALYST = EVIDENCE_SYNTHESIS) is **not** what selects the model. The capability does. Live evidence confirms NORMAL_DIALOGUE with `gpt-5.6-luna` for the answer and `gemini-3.5-flash-lite` FAST_CLASSIFICATION for the reader (RULES live evidence). Routing-policy tables, fallbacks and providers in `packages/model-gateway/src/policy|providers` were **not inspected**. The only things verified here are that `final.fallbackUsed`, `attempts`, `routingPolicyCode`, `providerCode` and `modelCode` are logged per answer (`index.ts:4193-4219`) and that `dataPosture` and `sensitivity` are passed to every call (`index.ts:2565-2582`).

---

## 4. One brain or many?

Users see one Q, but internally there are **many separately-prompted model "brains"** with their own charters, histories and state:

| Brain                                                                                                    | Prompt                                                                                               | Where it runs (from prompt id; caller not read unless cited)                       |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Conversational analyst (text and standard voice)                                                         | COMPANY_ANALYST v21 + Q_SYSTEM v2                                                                    | `index.ts:2538`                                                                    |
| Company Intelligence specialist                                                                          | its own prompt (not traced)                                                                          | `q-specialists/src/company/specialist.ts:367`                                      |
| Turn reader                                                                                              | TURN_READER v44                                                                                      | `turn-reader.ts:282`                                                               |
| Decision reader, app-action router and arguments, profile-gap reader, delegation reader, utterance check | DECISION_READER v2, APP_ACTION_* v1, PROFILE_GAP_READER v1, DELEGATION_READER v5, UTTERANCE_CHECK v1 | `q-intelligence.ts:427-457`, `main.ts:3727-3731`                                   |
| Duplex realtime voice model                                                                              | OpenAI realtime (`packages/model-gateway/src/realtime/openai.ts`); it calls `ask_q`                  | **not inspected**; live evidence shows it improvising when `ask_q` returned silent |
| Onboarding interview agent                                                                               | INTERVIEW_AGENT v16 (+ interview conductor history)                                                  | `apps/q-api/src/voice/interview-agent.ts` (not read)                               |
| Welcome / arrival                                                                                        | WELCOME_CONDUCTOR v2; web-side `returning.ts` / `arrival-voice.ts`                                   | not read                                                                           |
| Rehearsal twin                                                                                           | INVESTOR_TWIN_TURN v10, INVESTOR_PERSONA v6, REHEARSAL_SCORE v5                                      | not read                                                                           |
| Workforce writer and reviewer                                                                            | WORK_* , DRAFT_REVIEW v3, DRAFT_REDRAFT v3, JOB_PLAN, INSTRUCTION_PLAN v8                            | `q-orchestrator/src/workforce/*` (not read; RULES: threshold 75, 2 review rounds)  |
| Meeting host                                                                                             | MEETING_HOST_TURN v3, MEETING_NOTES v3                                                               | not read                                                                           |
| GateQ interviewer, Daily writer, memory extractor                                                        | GATEQ_INTERVIEWER, DAILY_*, MEMORY_EXTRACTOR v2                                                      | not read                                                                           |

**Count:** at least **10 distinct conversational or agentic brains**: analyst, specialist, duplex realtime, interview agent, welcome conductor, rehearsal twin, workforce converse/stand-in, meeting host, GateQ interviewer, errand reply. Each turn also runs **5+ classifier "readers"**.

Only the analyst path goes through the LangGraph orchestrator and the firewall plan shown here. Whether the other brains apply the same firewall was **not verified**. The live 11:13 evidence (duplex opener came from the web's generic copy rather than the briefing, and the realtime model improvised a reply) shows the voice brain can speak **without** the analyst. **Verdict: PARTIAL unification.** One runtime path exists for typed Q, but voice, onboarding, rehearsal and workforce are separate subsystems.

---

## 5. Routing that could block harmless conversation or require a role

- **No role gate on general chat.** `GENERAL_QUESTION` gets actor-wide scopes including `GENERAL_MODEL_KNOWLEDGE` (`purpose.ts:162-176`), and a person with no organisation may still run under a personal context (`requireActorContextOrPersonalHook`, `q-runs.ts:104-107`).
- **But** an entity subject without an organisation gives `ORGANISATION_CONTEXT_REQUIRED` (`firewall.ts:640-651`), and any unresolved subject denies the run (`firewall.ts:658-665`). A client that sends a stale or foreign `subjects` entry turns a harmless question into "I don't have information I can use…".
- Spoken turns marked `addressedToQ=false` or UNCLEAR are **not answered at all** (`answer.ts:2426-2463`). This is the documented cause of the 11:13 silence.
- `investor visibility` and `SET_VISIBILITY` choose different actions by role (`answer.ts:2555-2571`). `aboutCounterparty` widens tools only for investors with a company subject (`answer.ts:1728-1745`). `openReferenced` picks INVESTOR or FOUNDER side from the plan (`answer.ts:1870-1871`).
- Fit sweep is investor-only (`index.ts:1714-1719`).

---

## 6. Cost and token tracking

- **Per answer:** `last` observation plus an info log with provider, model, routing policy, attempts, fallback, latency, `costUsd`, token usage, prompt chars, tools offered and called, model calls, phases and streamed chars (`index.ts:4176-4219`).
- **Budgets:** per-call `maxEstimatedCostUsd` (FAST 0.02, NORMAL 0.10, SYNTHESIS 0.50, DEEP 1.00) (`index.ts:401-455`). The turn reader allows $0.01 per call (`turn-reader.ts:109-114`). These limits are per call, not per turn: a turn can make reader ×≤4, decision reader, router, arguments, and analyst rounds (1 + chained 1 + recovery/sayDo/gaps/load) + final.
- **Tool calls:** a hard ceiling of 10 per turn and 2 chained rounds (`index.ts:338`, `363`).
- **`ai_ops.model_usage`:** referenced as the usage ledger in comments (`turn-reader.ts:117-119`; `index.ts:2215-2218` "Model latency is already in the usage ledger"). The ledger writer (gateway infrastructure) was **not inspected**. A `/v1/q/usage` route exists (`apps/q-api/src/http/usage.ts`, not read).

---

## 7. Status summary

| Area                                                                                   | Status                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| HTTP run creation and autostart                                                        | IMPLEMENTED                                                                                    |
| `POST /runs/:id/messages`                                                              | CONFIGURED-UNUSED (stores, never answers)                                                      |
| LangGraph graph, firewall, retrieval, answer, approval                                 | IMPLEMENTED                                                                                    |
| Pause node                                                                             | CONFIGURED-UNUSED (`neverPause`)                                                               |
| Turn reader v44 incl. heardAs                                                          | IMPLEMENTED (deployed today; a known failing test in `answer-turn-reading.test.ts`, per RULES) |
| Spoken unclear handling                                                                | IMPLEMENTED as SILENT; contributes to the voice model improvising (live)                       |
| Code-run hands, app actions, hand-over, delegation                                     | IMPLEMENTED                                                                                    |
| Conversation-core state (unclear count, last action, focus, sequence, failure notices) | PARTIAL: in-memory, per-process                                                                |
| Unified Q across voice, onboarding, rehearsal, workforce                               | PARTIAL                                                                                        |
| Cost per turn                                                                          | PARTIAL: per-call budgets only, no per-turn cap seen                                           |
