# Findings — Investigator B (Q brain, memory/context)

## CONFIRMED DEFECTS

| id   | sev     | symptom                                                                                                                                                                                                                                                                   | evidence                                                                                                                          | root cause                                                                                                                                                                                             |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-01 | High    | A spoken turn read as UNCLEAR, or as not addressed to Q, gets no answer. On duplex, `ask_q` returns `{say:""}` and the realtime model improvises ("could you give me more detail…"), which is the live 11:13 behaviour                                                    | `packages/q-specialists/src/answer.ts:2442-2463` (`spoken ? {kind:"SILENT"}`), `2426-2437`                                        | A deliberate silent policy for voice noise collides with a second brain (the realtime model) that fills the silence. heardAs v44 (`answer.ts:2345-2378`) reduces the cases but keeps the SILENT branch |
| B-02 | Medium  | "Try again", "same for X", question series, failure-notice de-duplication, unclear counts and tool focus are lost on restart or deploy, and differ between instances                                                                                                      | `answer.ts:749-822`, `1679-1717`, `758-785`                                                                                       | Conversation-core state held in process `Map`s (LRU 500), not persisted                                                                                                                                |
| B-03 | Medium  | `POST /v1/q/runs/:runId/messages` stores a follow-up but nothing ever answers it                                                                                                                                                                                          | `apps/q-api/src/http/q-runs.ts:175-205` (comment line 195)                                                                        | Superseded design: the web creates a new run per message instead (`apps/web/src/features/q/actions.ts:202-340`). Dead or misleading public endpoint                                                    |
| B-04 | Medium  | The conversational answer uses NORMAL_DIALOGUE budgets (4,096 output tokens, $0.10, 45 s) though the prompt declares EVIDENCE_SYNTHESIS. Long analytical answers inside one JSON object risk truncation, which code comments elsewhere name as the cause of failed parses | `packages/model-gateway/src/q/index.ts:365-370`, `425-431`, `432-446`, `2230`; COMPANY_ANALYST v21 `taskClass=EVIDENCE_SYNTHESIS` | The task class comes from the client capability, not from the prompt                                                                                                                                   |
| B-05 | Low/Med | Every turn, including a greeting, pays for the turn reader (up to 4 attempts), a decision reader when a card waits, about 4–8 prefetch tool reads and a tool-bearing analyst call with up to 127 tool definitions. There is no cheap small-talk path                      | `answer.ts:1967-2026`, `2268-2314`; `index.ts:1656-2145`; `registry.ts:32`                                                        | The ladder is built for capability, not cost                                                                                                                                                           |
| B-06 | Low     | The heardAs path inserts the likely words as a new USER line but leaves the garbled original in history, so both are read back by every later turn                                                                                                                        | `answer.ts:2355-2367`; `utterances.ts:23-49` (a distinct `:heard` ref, so no supersede)                                           | Design choice ("kept, never overwritten") without a read-back filter                                                                                                                                   |
| B-07 | Low     | Contradictory instructions to the model: "Tools only read." against CAPABILITIES_NOTE / NEXT_STEP_NOTE "prepare that change with the right tool", while `propose_*` tools are SIDE_EFFECT                                                                                 | `index.ts:956` vs `695`, `802`; `packages/q-tools/src/tools/relationships.ts:563-564`                                             | The notes text is out of date                                                                                                                                                                          |
| B-08 | Low     | The graph passes `retrieval: {kind:"AUTHORISED_REFERENCES", referenceCount: 0}` regardless of what retrieval produced. The retrieval node's output is reduced to its `kind`                                                                                               | `packages/q-orchestrator/src/graph.ts:341-349`, `377-380`                                                                         | The seam was never wired through. The analyst re-assembles context itself (`index.ts:1658`)                                                                                                            |
| B-09 | Info    | The pause node is wired but `pausePolicy: neverPause`                                                                                                                                                                                                                     | `apps/q-api/src/main.ts:3795`; `graph.ts:292-300`                                                                                 | CONFIGURED-UNUSED                                                                                                                                                                                      |
| B-10 | Info    | A known failing test on base: `answer-turn-reading.test.ts` "hands on a manifest…" (per lead; not re-run by me)                                                                                                                                                           | RULES.md                                                                                                                          | —                                                                                                                                                                                                      |

## UNVERIFIED RISKS

- **B-R1:** "What needs my attention" misses unanswered inbound chat messages. The prefetched _own day_ covers schedule, pending approvals, Q work and rehearsals only (`index.ts:1981-2002`). Verify by reading `ownDayFact` (`model-gateway/src/q/own-day.ts`) and `ownStandingFact` (`own-standing.ts`) for an "awaiting your reply" category, and replay the live run.
- **B-R2:** The non-analyst brains (duplex realtime, interview agent, welcome conductor, rehearsal twin, workforce, meeting host) may not apply the same Context Firewall plan. Verify by reading `apps/q-api/src/voice/duplex/broker.ts`, `voice/interview-agent.ts`, `composition/rehearsals.ts` and `q-orchestrator/src/workforce/*` for `firewall.plan` usage.
- **B-R3:** The analyst's conversation variable is unbounded in tokens (≤63 messages × ≤32,000 chars). Verify with `promptCharacters` from the "q answer produced" logs on long conversations, and look for context-limit failures (`CONTEXT_LIMIT` → MODEL_PROVIDER_UNAVAILABLE, `index.ts:474-478`).
- **B-R4:** The graph retrieval step's work is unused, which doubles latency. Verify `createQEvidenceRetrieval` port and context caching (`packages/q-knowledge/src/q/evidence-retrieval.ts:91`).
- **B-R5:** Turn-level cost is unbounded: per-call caps exist, a per-turn cap was not found. Verify `ai_ops.model_usage` aggregation per `q_run_id`.
- **B-R6:** A stale or foreign `subjects` entry from a client denies the whole run with the generic "not available" sentence (`firewall.ts:658-665`). Verify which web surfaces send `subjects` versus `screen`.
- **B-R7:** Whether `memory` is fenced as untrusted in COMPANY_ANALYST, and whether memory writes pass a deterministic gate. Verify in `q-core/src/prompts/schemas/company-analyst.ts` (untrusted list) and the memory learner.

## OPEN QUESTIONS

- Does the duplex realtime model receive the analyst's answer verbatim (ask_q) or summarise it? Was `ask_q` silence redesigned today (`contracts voice.ts silent`)?
- Is the conversation-core state expected to survive a Render deploy? How many q-api instances run?
- Is `appendMessage` used by any client (relationships or work surfaces use different `/messages` routes)?
- What are the routing-policy fallbacks for NORMAL_DIALOGUE and FAST_CLASSIFICATION (`packages/model-gateway/src/policy`, not read)?

## EVIDENCE INDEX

- One orchestrator path for typed Q → `q-runs.ts:111-163`, `orchestrator.ts:334-395`, `graph.ts:481-509`
- Answer seam = specialist wrapper plus conversational delegate → `q-intelligence.ts:320-371`, `405-544`; `answer.ts:3105-3117`
- History windows 64 / 6×400 / 12×4,000 / all earlier → `answer.ts:1973-1977`, `turn-reader.ts:269-272`, `answer.ts:649-671`, `index.ts:2495-2499`
- Conversation history goes into the USER message, not chat turns → `renderer.ts:197-200`, COMPANY_ANALYST template "CONVERSATION SO FAR"
- Untrusted fencing → `q-core/src/prompts/definition.ts:247-322`
- Environment notes bound of 9,000 and ordering → `index.ts:686`, `903-1063`
- Tool loop limits (2 rounds, 10 calls) → `index.ts:338`, `363`, `3214-3223`
- Tool pipeline (offered, Zod, actor/plan, authorize, sensitivity, output) → `q-tools/src/executor.ts:142-370`
- Two tool lanes only (SAFE_READ / LOW_RISK_INTERNAL SIDE_EFFECT) → `q-tools/src/registry.ts:195-205`
- No role gate; GENERAL_MODEL_KNOWLEDGE actor-wide → `q-firewall/src/purpose.ts:73-75`, `162-176`
- Denial sentence → `contracts/src/q/failure.ts:110-111`, `170`
- Prepare → Approve → Execute → `relationships.ts:574-614`, `main.ts:3252-3281`, `graph.ts:404-467`, `orchestrator.ts:397-458`, `pending-decision.ts:459-626`
- 54 ACTIVE prompts (TURN_READER v44, COMPANY_ANALYST v21, Q_SYSTEM v2, Q_SYSTEM_VOICE v3) → `evidence/brain/prompts-active-texts.md`; registry rule `registry.ts:306-312`
- Spoken unclear → SILENT → `answer.ts:2448-2450`
- heardAs recursion → `answer.ts:2345-2378`
- Per-answer cost and model logging → `index.ts:4176-4219`

## COVERAGE

**Inspected:**

- `apps/q-api/src/http/q-runs.ts` and `q-conversations.ts`
- `apps/q-api/src/composition/q-intelligence.ts` (233-556)
- `main.ts` (3700-3830 and 3252-3282)
- `q-orchestrator/src/orchestrator.ts`, `graph.ts`
- `q-specialists/src/answer.ts` (1-500, 637-3390, nearly complete)
- `pending-decision.ts` (outline)
- `model-gateway/src/q/index.ts` (317-1100, 1501-3500, 3640-3830, 4150-4340)
- `model-gateway/src/q/turn-reader.ts`
- `q-core/src/prompts/renderer.ts`, `definition.ts` (240-352), `schemas/common.ts`, charters
- `q-firewall/src/purpose.ts`, `firewall.ts` (620-800)
- `q-tools/src/registry.ts`, `executor.ts`, `tools/relationships.ts` (555-640)
- `profile-change-board.ts` (60-235)
- `q-runtime` postgres message reads, `utterances.ts`
- `contracts/src/q/request.ts`, `failure.ts`

**Not inspected:**

- voice routes and the duplex broker
- the realtime adapter
- the memory learner and extractor
- `references.ts`, `hand-over.ts`, `speculation.ts`, `page-request.ts` bodies
- the company specialist
- the model-gateway policy, providers and usage ledger
- `q-knowledge` retrieval SQL
- the workforce and review loop
- the rehearsal, interview and welcome agents
- `index.ts` 3500-3640 and 3830-4150 (tool-result handling, approval lines, cards)

No tests were run.
