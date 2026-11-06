# Q Premium Plan — from a smart conversation to a premium assistant

Status: PROPOSED (owner ask, 6 Nov 2026). Planning lane, branch `docs/q-premium-plan` from `fix/resume-asking-cv9ru3` @ `f9d09b1`.

Precedence: below the locked PADL, CLAUDE.md invariants, ADRs and `Q_INTELLIGENCE_PLAN.md`. This plan follows that one: it does not reopen steps 0–11. Every step keeps these intact:

- the Context Firewall (filter before the model);
- RLS and tenant isolation;
- the Write Gate;
- approval bound to the exact payload;
- the truth-class, evidence-status and lifecycle axes;
- no pay-to-rank and no engagement optimisation;
- Q Knowledge ≠ Data Room disclosure;
- unknown stays unknown.

## Where we start

The conversation-IQ programme is nearly done. The latest live sample (`receipts/2026-11-06-qiq-live-sample/`, `7a41ff4d0`):

| Measure             | Q         | Bare model |
| ------------------- | --------- | ---------- |
| Turns passed        | 95.2%     | 97.6%      |
| Invented figures    | 0         | 0          |
| Wrong-entity turns  | 0         | 0          |
| Ambiguity clarified | 100%      | 0%         |
| Whole-reply p50     | **7.3 s** | 1.1 s      |

So Q is now honest and accurate in conversation. Three things stand between it and "premium":

1. **It is slow.** The turn reader alone takes about 4–5 s of a 4–6 s first sentence (`HANDOFF-LOG.md:1583`).
2. **It can go down.** On 5 Nov the OpenAI balance ran out and production Q said "I can't reach my reasoning service" (`HANDOFF-LOG.md:1566`; also 31 Oct, `HANDOFF-2026-11-01.md:124-131`). OpenAI is the only route approved for confidential data.
3. **Many capabilities are built but not wired into chat.** The owner is right that the rudiments are there. The audit below finds at least 12 complete-but-unwired pieces. They are the cheapest wins.

## 1. Audit

Status key:

- ✅ built and wired into the live path;
- ◐ partial, or built but not wired;
- ✗ missing.

**Bold** marks a complete-but-unwired piece (a cheap win). Paths are relative to the repo root; `q/` means `packages/model-gateway/src/q/`.

### 1.1 Presentation and action choice

| Item                                   | Status | Evidence                                                                                                                                                                                                                                        |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block contract (25 kinds)              | ✅     | `contracts/src/q/result-block.ts:755-781`: TABLE, CHART, MAP, TIMELINE, PICTURE, COMPARISON(\_CARDS), ANSWER_CARDS, NAVIGATION_OFFER, ARTIFACT_REFERENCE, PLAN and more.                                                                        |
| Web renders them                       | ✅     | `apps/web/src/features/q/q-result-blocks.tsx:430-640`; evidence kinds in `q-evidence.tsx:51-63`.                                                                                                                                                |
| Where each kind sits (thread vs stage) | ◐      | A fixed table, not chosen per answer: `contracts/src/q/block-surfaces.ts:62-90`.                                                                                                                                                                |
| One model-led choice of surface        | ◐      | The analyst proposes `visual` (MAP/TABLE/CHART/TIMELINE/PICTURE; `q-core/src/prompts/schemas/company-analyst.ts:552`) and code builds it from reads (`q/result-blocks.ts:996-1058`). The turn reader has no surface field (`q/turn-reader.ts`). |
| Regex shortcuts that bypass the model  | ◐      | `q/compare-table.ts:36-60`, `q/companies-map.ts:40-92`, `q/re-render.ts:14-40`, `q/q-card-offer.ts:23`, `asksForSummary` (`q/result-blocks.ts:680`). These conflict with the owner's "no keyword rules over people's words".                    |
| **CHART**                              | ◐      | Contract, builder (`q/result-blocks.ts:818`), tests and web renderer exist. `visualBlock` returns null for CHART on purpose (`:1044-1046`): no typed source of evidenced figures feeds it yet.                                                  |
| **NAVIGATION_OFFER**                   | ◐      | Generic pipeline and card (`web navigation-offer-card.tsx`), but only two destinations, CRM pipeline and relationships (`q-specialists/src/answer.ts:1817-1836`).                                                                               |
| Navigate tools                         | ✅     | `open_page` and `show` (`q-tools/src/tools/client-actions.ts:662, 982`).                                                                                                                                                                        |
| Stage                                  | ✅     | `web q-presence-stage.tsx:97-109, 496, 550`.                                                                                                                                                                                                    |
| **Board**                              | ◐      | `QBoard` (`web q-board.tsx:318`) is rendered only in a test; only `useBoardMarks` and `QBoardTimeline` are live.                                                                                                                                |
| Artifacts and live preview             | ✅     | `apps/q-api/src/main.ts:4679`; `q/index.ts:7231, 6705`.                                                                                                                                                                                         |
| Pictures                               | ◐      | Pexels and public web only (`result-block.ts:545`). A deck's own images are shown only in the artifact viewer (`web slide-pictures.tsx`), never as a PICTURE answer.                                                                            |
| **Block motion**                       | ◐      | Motion is loaded (`answer-canvas.tsx`), but blocks in `q-result-blocks.tsx` have no enter or exit transition.                                                                                                                                   |
| "Right surface chosen" eval            | ✗      | Only a picture eval (`q-evals/src/pictures/scenarios.ts`). Q-IQ graders check no blocks.                                                                                                                                                        |

### 1.2 Doing the work

| Item                               | Status | Evidence                                                                                                                                                                                      |
| ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search providers + breaker         | ✅     | Seven adapters (`q-research/src/providers/`), searched in parallel and merged (`apps/q-api/src/composition/research.ts:319-400`); 15-min rest on 401/402 (`providers/breaker.ts:20-29`).      |
| Web search in chat                 | ✅     | `research_public_web` (`q-tools/src/tools/research-public-web.ts:248`).                                                                                                                       |
| Web discovery (find new companies) | ◐      | Lane `feat/q-web-discovery` is in progress (`ACTIVE-TASKS.md:15`); the branch is **not yet on the remote**.                                                                                   |
| **Deep research**                  | ◐      | `createDeepResearch` (`q-research/src/application/deep-research.ts:151`; 12 questions, 48 sources) runs only as a background workforce step. A chat turn never runs it.                       |
| **Source cross-check**             | ◐      | `crossCheck` (`q-research/src/domain/cross-check.ts:397`) is used only in workforce research, not in chat.                                                                                    |
| Citations                          | ◐      | Code-built source line (`q/result-blocks.ts:271-285`) and PUBLIC_SOURCE blocks. No sentence-level citations in chat.                                                                          |
| Diligence memo from a deck         | ✅     | Background job with research step first (`q-orchestrator/src/workforce/plan.ts:184`), fixed sections (`diligence-memo.ts:11`), figure checks (`workforce/claims.ts`).                         |
| Comparison table                   | ◐      | Built by code (`q/compare-table.ts`), 2–4 companies, profile and fit cells only. **Web and data-room reads already run in the same turn (`q/index.ts:3724, 3775`) but never become columns.** |
| Workforce                          | ✅     | 10 roles (`workforce/registry.ts:49-123`), review loop of 2 rounds.                                                                                                                           |
| Tool registry and loop             | ✅     | 116 tools (`q-tools`); normal turns 2 rounds / 10 calls (`q/index.ts:811, 836`); deep turns 5 / 16 / 30 s (`tool-loop-budget.ts:21-28`).                                                      |

### 1.3 Documents and numbers

| Item                                                 | Status | Evidence                                                                                                                                  |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PDF, docx, pptx parsing                              | ✅     | Sandboxed child process (`apps/workers/src/parser/child.ts:58, 97`); `extractors.ts:230, 472`.                                            |
| Tables in PDFs                                       | ◐      | Rebuilt from layout as text joined with " \| " (`parser/pdf-layout.ts`). No table object.                                                 |
| Charts                                               | ◐      | pptx chart data is read (`extractors.ts:344-432`); charts in PDFs only via the vision page transcriber (`documents/pipeline.ts:151-156`). |
| xlsx and csv                                         | ✅     | In-house reader, formulas never run (`parser/spreadsheets.ts`).                                                                           |
| Data-room documents in chat                          | ✅     | Up to 2 documents, 7,000 chars, through `read_document_pages` (`q/data-room-document-fact.ts`; `q/index.ts:3724-3758`).                   |
| **Stored deck readings in chat**                     | ◐      | `createDeckReader` and the diligence summariser are imported in `q/index.ts:557, 584` but called only by workers.                         |
| Financial model projection                           | ◐      | `OWN_FINANCIAL_MODEL` (`q-tools/src/tools/spreadsheet-model.ts`) projects cash, labelled ESTIMATE, but only inside `make_spreadsheet`.    |
| **Dilution**                                         | ◐      | `ownershipEstimate` (`packages/capital/src/domain/rounds.ts:310`) is used only by `apps/api` commitments, not by Q.                       |
| Runway, burn multiple, cohorts, valuation, scenarios | ✗      | No deterministic calculator anywhere.                                                                                                     |

### 1.4 Proactive briefing

| Item          | Status | Evidence                                                                                                                                  |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Q Daily       | ✅     | Emailed 07:00 local (`q-daily/src/schedule.ts:9`).                                                                                        |
| Daily ranking | ◐      | Topic hits + freshness + publisher (`q-daily/src/relevance.ts:137-141`). No engagement signal (good). Mandate counts only as topic words. |
| What needs me | ✅     | Fixed source order, newest first (`q-tools/src/tools/attention.ts:54-66, 181`).                                                           |
| Home opener   | ✅     | Fixed wording, opens clean (`web features/briefing/opener.ts`; DECISIONS 54).                                                             |
| New matches   | ✅     | Mandate ranking with fit reasons (`web briefing/matches.ts`).                                                                             |
| Push          | ◐      | Web Push exists (`communication/src/push/delivery.ts`) but is never used for briefings.                                                   |

### 1.5 Knowing the person

| Item                          | Status | Evidence                                                                                                                                                              |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Communication profile**     | ◐      | Built (`q-knowledge/src/memory/communication.ts:122`), but the main answer path always gets the default (`q/index.ts:3189-3191`): q-api never passes `communication`. |
| **`note_preference` tool**    | ◐      | Registered only in the voice interview agent (`apps/q-api/src/voice/interview-agent.ts:1406`).                                                                        |
| Memory learn, recall, consent | ✅     | `main.ts:5228, 5317`; quotes verified before writing.                                                                                                                 |
| Memory list / forget          | ◐      | Settings UI only (`apps/q-api/src/http/memory.ts:56, 115`); Q cannot list or forget on request.                                                                       |
| Language                      | ✅     | `main.ts:5064-5078`.                                                                                                                                                  |
| Mandate and thesis            | ✅     | `q/own-mandate-answer.ts`; `q/index.ts:4372-4376`.                                                                                                                    |
| **Pass reasons**              | ◐      | Captured (`discovery/src/interactions/contracts.ts:108-119`); Q sees only SAVED/PASSED (`q-tools/src/tools/discovery-slate.ts:88-101`), never the reason.             |
| Past-chat recall              | ✅     | `q-api/src/composition/q-intelligence.ts:659`.                                                                                                                        |

### 1.6 Self-check and confidence

| Item                             | Status | Evidence                                                                                                                                                             |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim check (figures, names)     | ✅     | Per sentence and whole answer (`q/index.ts:6909, 6990, 10463`); also workforce drafts.                                                                               |
| Promise, screen, artifact checks | ✅     | `q/promise-check.ts`, `screen-claims.ts`, `artifact-claims.ts` (`q/index.ts:6883-6997`).                                                                             |
| Fit integrity                    | ✅     | `q/index.ts:5195, 7404`.                                                                                                                                             |
| Model self-check on deep answers | ✗      | Not built (plan step 6 option; A14).                                                                                                                                 |
| Confidence                       | ◐      | Self-stated HIGH/MEDIUM/LOW on recommendations only (`company-analyst.ts:80`). `insufficientEvidence` only drives "could not answer" (`q/result-blocks.ts:355-358`). |
| Truth class in answers           | ✅     | `coherentEvidence` stops inference shown as verified (`q/result-blocks.ts:148`).                                                                                     |

### 1.7 Speed

| Item                       | Status | Evidence                                                                                                                                                         |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answer reasoning by kind   | ✅     | `ANSWER_REASONING_V1` (`q/index.ts:991-998`): chat/lookup NONE, follow-up LOW, comparison/analysis/document MEDIUM.                                              |
| Reader reasoning           | ◐      | Hard-coded LOW (`q/turn-reader.ts:583`). The policy key that would let it go to NONE was in the reverted commit.                                                 |
| Reader cost                | ✗      | About 16.8k prompt tokens, 54k chars of rules; 4.9 s of a 6.2 s first sentence (`HANDOFF-LOG.md:1583`).                                                          |
| Streaming, early lead line | ✅     | `firstTextMs` (`q/index.ts:7081`), early lead (`:6313`).                                                                                                         |
| Early reading (ADR 0035)   | ✅     | `answer.ts:4758`; misses the first turn and page changes.                                                                                                        |
| **Speculation**            | ◐      | Voice only (`q-api/src/composition/q-intelligence.ts:166-170`). Latent bug: it never checks the reader's binding; the fix was lost in the revert.                |
| Page-aware prefetch        | ◐      | Route/code prefetch only (`web q-presence-stage.tsx:37`, `control/router-registry.ts:90-95`). No server pre-read of the page's subject.                          |
| Progress stages            | ✅     | 20 visible stages (`contracts/src/q/stage.ts:18-48`).                                                                                                            |
| **Latency telemetry**      | ◐      | Logs only. Metrics are emitted (`q_sse_time_to_first_event_ms`) but OpenTelemetry export is off and the SDK is not installed (`observability/src/telemetry.ts`). |

**The reader head-start rollback (`4c04b5f3e`).** Merge of `feat/q-reader-latency` @ `a45446c`. It started the turn reader beside the database lanes instead of after them. Those lanes include resolving a company by name. The reader's inputs were fixed at start, so the reader saw "Ledgerfold" as unresolved. Live on 6 Nov 06:11 it asked "who do you mean by 'Ledgerfold'?" and "I'm not sure who you mean by she/his/they" (`HANDOFF-LOG.md:1589-1590`). Reverted at 06:24 (`917ddb4`, `2e1107b`). Offline it showed no gain (5,530 → 5,529 ms) because scripted Q-IQ has no live reader. The revert also removed two good, separable pieces: the speculation binding fix and the `TURN_READER` reasoning policy key.

### 1.8 Reliability

| Item                       | Status | Evidence                                                                                                                                                        |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers                  | ◐      | OpenAI, Google, Groq, fake (`model-gateway/src/providers/`). No Anthropic adapter.                                                                              |
| Routing and fallback       | ✅     | `ai_ops.routing_policies` with preferred/fallback and hedging; bounded retry (`gateway.ts:62-70`).                                                              |
| Credit-exhausted detection | ✅     | `providers/openai.ts:99-115`; provider blocked 10 min with a 30 s probe (`policy/health.ts:64, 77`).                                                            |
| Confidential-grade backup  | ✗      | OpenAI is the only CONFIDENTIAL route. Google is UNREVIEWED (PUBLIC only). Groq has zero-retention terms (`20260914090000`) but is not a confidential fallback. |
| Balance alert              | ✗      | Only an ERROR log when a block opens (`gateway.ts:715-725`). No balance check, no alert to the owner.                                                           |
| Graceful degradation       | ✅     | "What you said is kept" (`q-core/src/conversation/failures.ts`; `answer.ts:8232`). But Q is then simply down for confidential turns.                            |
| Search providers           | ◐      | Breaker works. ScrapingBee 401 and Serper 402 are resting; Brave and Tavily OK (`ACTIVE-TASKS.md:16`).                                                          |

### 1.9 Voice

| Item                    | Status | Evidence                                                                                                                                                              |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplex line             | ✅     | On in production (`voice/duplex/config.ts`); Deepgram fallback.                                                                                                       |
| Same answer path        | ✅     | `ask_q` runs the standard turn with firewall, tools and approvals (`duplex/broker.ts:82-96`); cards reach the page (`web use-q-conversation.ts:158-163`).             |
| Claim check after voice | ◐      | The realtime model **paraphrases** `ask_q` output after the claim check (`web .../duplex-line.ts:234`). Greetings and small talk never reach Q (`duplex/routing.ts`). |
| **Sideband**            | ◐      | Built and tested with fakes, off, never verified live (`duplex/config.ts:50-55`).                                                                                     |
| Voice in Q-IQ           | ✗      | No case runs through the voice path.                                                                                                                                  |

### 1.10 Measuring in real use

| Item                | Status | Evidence                                                                       |
| ------------------- | ------ | ------------------------------------------------------------------------------ |
| Q-IQ                | ✅     | 11 categories, 150 cases (`q-evals/src/datasets/q-iq/contracts.ts:14-31`).     |
| Evals in CI         | ◐      | Scripted Q-IQ only (`.github/workflows/ci.yml:293-310`). Live runs are manual. |
| Thumbs on answers   | ✗      | No contract, table or UI.                                                      |
| Production sampling | ✗      | Samples are run by hand.                                                       |
| New categories      | ✗      | No PRESENTATION, DISCOVERY, DOCUMENTS or CALCULATIONS category.                |

### Cheapest wins (built, not wired)

1. Communication profile into the main answer path (one port in `q-intelligence.ts`).
2. `note_preference` registered for main Q, not only the interview agent.
3. Pass reasons readable by Q.
4. NAVIGATION_OFFER for every page in the router registry, not two.
5. CHART fed from typed figures that already exist (comparison cells, financial-model projection).
6. Comparison table columns from the web and data-room reads that already run in the same turn.
7. `ownershipEstimate` and the financial-model projection exposed as read tools.
8. Stored deck readings and document summaries read in chat.
9. Deep research and `crossCheck` startable from chat.
10. Speculation binding fix and `TURN_READER` policy key cherry-picked from `a45446c`.
11. OpenTelemetry export turned on.
12. Block enter/exit motion with the Motion library already loaded.

## 2. Steps

Ordered by impact per effort. Each step lands on its own branch with failing-first tests and goes through the release lane (gates → CI → deploy → live check). Every reader or binding change also gets a **short live check** before it counts (lesson of `4c04b5f3e`).

### Step P0 — Measure the new ground first

- **Goal:** extend Q-IQ before changing anything, so each later step reports a delta.
- **Build:** four new categories, 15 cases each, on the fictional world:
  - **PRESENTATION.** Each turn records the expected surface: TEXT, CARDS, TABLE, CHART, MAP, TIMELINE, PICTURE, NAVIGATION_OFFER, DOCUMENT, or "none". The grader reads the reply's blocks. Also: a visual must never carry a figure that is not in the authorised facts.
  - **DISCOVERY.** Recorded web pages (DECISIONS 48: real public companies, pages recorded once, replayed in CI). Checks: every company named has a source URL from the recording; no invented company; mandate fit labelled as inference.
  - **DOCUMENTS.** Fictional decks, PDFs with tables and xlsx models. Checks: the expected figure from a table cell or spreadsheet range, with the page or sheet cited.
  - **CALCULATIONS.** Runway, burn multiple, dilution, cohort retention, implied valuation. Checks: exact arithmetic, labelled as a calculation, every input sourced (DECISIONS 61).
- **Also:** latency columns in every live run: first token, first sentence, whole reply, p50 and p95.
- **Files:** `packages/q-evals/src/datasets/q-iq/`, `packages/q-evals/src/graders/q-iq.ts`, a recorded-pages fixture under `q-evals`.
- **Bar:** the 60 cases exist, the scripted reference run is 100%, and a first live baseline (Q vs bare) is recorded in `BASELINE.md` with cost.
- **Migration:** no. **Owner decision:** no (live run within the approved Q-IQ budget).

### Step P1 — Never down again (reliability)

- **Goal:** a credit or provider outage never takes Q down silently again.
- **Build:**
  - **Balance alert.** A scheduled check of each paid model and search provider's remaining balance (where the provider exposes it), plus spend-rate from `ai_ops.model_usage`. An alert by email and push to the owner at a threshold, and immediately when a provider block opens (`gateway.ts:715`).
  - **Pre-run guard.** A live eval refuses to start below a stated balance (lesson of 5 Nov).
  - **Confidential backup.** A second CONFIDENTIAL-eligible route in `ai_ops.routing_policies` as fallback for every task class. Which provider is the owner's governance call (see decisions). Until approved, nothing confidential goes to a new provider.
  - **Honest degradation.** If no eligible route exists, Q still answers PUBLIC-only and app-data questions that need no confidential context, and says plainly what it cannot do now.
  - **Search.** Resting providers show on the owner's status line; a provider resting more than 24 h raises the same alert.
- **Files:** `packages/model-gateway/src/gateway.ts`, `policy/health.ts`, `policy/eligibility.ts`, a worker job in `apps/workers`, `packages/communication` for delivery.
- **Bar:** a chaos test (scripted provider returns `credit_balance_exhausted`) shows: alert sent within 60 s; ≥ 99% of Q-IQ turns either answered by the backup or degraded honestly; 0 confidential payloads sent to an ineligible provider (code-asserted on the gateway's eligibility log).
- **Migration:** yes, for the routing rows and any alert settings (additive). **Owner decision:** yes, the backup provider and alert thresholds.
- **Parallel:** with P0 and P2.

### Step P2 — Know the person (wire what exists)

- **Goal:** Q applies what it knows about the person quietly, without being asked.
- **Build:**
  - Pass the communication profile from memory into the main answer path (`q-intelligence.ts` → `q/index.ts:3189`).
  - Register `note_preference` for main Q, with the same consent and Write Gate.
  - A read tool for the person's own **pass and save reasons** (`discovery/src/interactions`), firewall-scoped to the owner. Q uses them as declared reasons; it never rewrites the declared mandate from behaviour.
  - "What do you remember about me?" and "forget that" as Q tools over the existing memory endpoints, with forget behind a confirm card.
  - Memory keeps who said it (USER_CLAIM vs Q_INFERENCE), as in plan step 9.
- **Files:** `apps/q-api/src/composition/q-intelligence.ts`, `q-tools/src/tools/note-preference.ts`, a new `q-tools` read tool, `q-knowledge/src/memory/communication.ts`.
- **Bar:** a new Q-IQ PERSONAL set (10 cases): a stated preference ("short answers", "in French", "I pass on pre-revenue") is applied in the next conversation ≥ 95%; 0 inferred preferences presented as stated; 0 reads of another person's memory (negative test).
- **Migration:** no. **Owner decision:** no.
- **Parallel:** with P0, P1.

### Step P3 — Speed: first token ≤ 1.5 s

- **Goal:** Q feels instant. The owner chose measure-first for reader reasoning.
- **Build, in this order:**
  1. **Measure.** Turn on OpenTelemetry export (install the SDK, `CQ_TELEMETRY_EXPORT=otlp`) so first-token and first-sentence p50/p95 are visible from production, not only logs.
  2. **Cherry-pick the safe parts of `a45446c`:** the speculation `BOUND` fix and the `TURN_READER` policy key. No ordering change.
  3. **Reader NONE, measured.** Flip the policy row to NONE. Keep it only if live Q-IQ shows no category drop vs LOW (owner's choice: measure first).
  4. **Shrink the reader prompt.** 16.8k tokens is the main cost. Move rule text into the schema and examples; target ≤ 6k tokens with no Q-IQ drop.
  5. **Re-land the head-start safely.** The reader needs the resolved names. So:
     - first run only the **name resolve** (a fast indexed lookup of the ledger and named-company index, target ≤ 150 ms) and pass its result to the reader;
     - then start the reader in parallel with every other lane;
     - never fix the reader's inputs before the resolve returns.
     - Gate: a 6-case **live smoke set** (PRO-001 pronouns, "who are Ledgerfold's founders?", "Silo" ambiguity, a follow-up, a correction, a compound) must pass before deploy, behind a per-conversation flag first.
  6. **Page-aware pre-read.** When a person opens a company, investor or document page, pre-read its subject facts under their authority (ADR 0035 early reading, extended to page entry), so the first question about "this company" is warm.
  7. **Typed-turn speculation**, once the binding fix is in.
- **Files:** `q/turn-reader.ts`, `q-specialists/src/answer.ts` (lane order), `q/speculation.ts`, `packages/observability`, `web control/router-registry.ts`, a routing-policy migration.
- **Bar (production, measured by telemetry):** first token p50 ≤ 1.5 s, p95 ≤ 4 s; follow-up first sentence p50 ≤ 2.5 s, p95 ≤ 6 s; no Q-IQ category drops more than 1 point vs the step's start; the live smoke set 6/6.
- **Migration:** yes (policy row). **Owner decision:** no; reader NONE is kept or rolled back on the measurement.
- **Parallel:** items 1–2 with P1/P2; items 3–7 own the reader, one lane at a time.

### Step P4 — One presentation decision

- **Goal:** Q decides, by meaning, how to show the answer: words, cards, a table, a chart, a map, a timeline, a picture, a document, or an offer to open a page. It does it smoothly.
- **Build:**
  - The turn reader returns `present: { surface, why }` with surface from a closed list. This is one model-led decision.
  - Code builds the block **only from typed reads** in the run, as today. A visual never takes numbers from model prose. If the reads cannot fill the chosen surface, Q falls back to text and says nothing about a visual (artifact-claims check already enforces this).
  - Remove the regex shortcuts (`compare-table.ts`, `companies-map.ts`, `re-render.ts`, `q-card-offer.ts`, `asksForSummary`) once PRESENTATION shows the model path ≥ the regex path.
  - **NAVIGATION_OFFER for every page** in the router registry, not two. Q offers; the person taps. Q navigates directly only when asked to ("open Silo's profile").
  - Placement per answer: a big table or chart goes to the stage, a one-line fact stays in the thread (`block-surfaces.ts` becomes a default, not a law).
  - **Motion:** blocks enter and leave with the existing Motion setup (short fade and rise, ≤ 200 ms, interruptible). Reduced motion turns it off.
  - Decide the unwired `QBoard`: wire it as the stage's board or delete it (no dead code).
- **Files:** `q/turn-reader.ts`, `q/result-blocks.ts`, `contracts/src/q/block-surfaces.ts`, `q-specialists/src/answer.ts:1817-1836`, `web features/q/q-result-blocks.tsx`, `web q-board.tsx`.
- **Bar:** PRESENTATION ≥ 95% right surface; 0 visuals carrying an unsourced figure; INP ≤ 200 ms and CLS ≤ 0.1 on the Q page with blocks animating (Playwright trace); no other Q-IQ category drops.
- **Migration:** no. **Owner decision:** no.
- **Depends on:** P0. **Parallel:** with P5 (different files); not with P3 items 3–5 (both touch the reader: one owner at a time).

### Step P5 — Calculators and charts with real numbers

- **Goal:** Q does the arithmetic investors do, exactly, and can draw it.
- **Build:**
  - One deterministic module of pure functions: runway (cash ÷ net burn), burn multiple (net burn ÷ net new ARR), dilution and post-round ownership (wrap `ownershipEstimate`), implied pre/post-money, simple cohort retention, and a scenario run (base / low / high on growth and burn).
  - Money is `numeric` with ISO currency, never float. Each result carries its inputs, their sources and truth class ESTIMATE.
  - One typed Q read tool, `calculate`, that takes **fact ids** or the person's own stated figures, never free numbers from model prose. Missing inputs return UNKNOWN with the missing field named; they are never filled with zero.
  - Results are typed reads, so they can feed a CHART or TABLE (this is what unblocks CHART).
  - Expose the financial-model projection as a read ("when does Silo run out of cash?") as well as a spreadsheet.
  - Claim check treats a `calculate` result as grounded (DECISIONS 61).
- **Files:** a new `metrics` module in `packages/capital/src/domain/` (it owns rounds and money already), a tool in `packages/q-tools`, `q/result-blocks.ts` (CHART from typed results), `q/claim-check.ts`.
- **Bar:** CALCULATIONS 100% exact and labelled; unknown inputs said as unknown 100%; unit tests on every formula including zero burn, negative growth and mixed currencies (refused, not converted silently).
- **Migration:** no. **Owner decision:** no.
- **Parallel:** with P4.

### Step P6 — Documents and data rooms, read properly

- **Goal:** Q answers from a deck's tables, a data room's PDFs and a founder's xlsx model as well as from text.
- **Build:**
  - Tables in PDFs become **table objects** (rows, columns, page) at parse time, not " \| " text. The same for xlsx ranges.
  - A read tool returns a cell or table with its page or sheet citation, under the existing data-room access check. Q Knowledge stays separate from Data Room disclosure: Q only reads what this person may see now.
  - Feed the **stored deck reading** (12 sections, already made by workers) into chat for "what does their deck say about…".
  - A deck's own images as PICTURE answers (owner's "image from a deck"), with page credit, only for people who may see the deck.
  - Charts in PDFs: the vision page transcriber returns a chart's series as a table where legible; otherwise "the chart isn't readable as numbers".
- **Files:** `apps/workers/src/parser/pdf-layout.ts`, `parser/spreadsheets.ts`, `documents/pipeline.ts`, `q/data-room-document-fact.ts`, `q/deck-reader.ts`, `contracts/src/q/result-block.ts` (PICTURE source DECK).
- **Bar:** DOCUMENTS ≥ 95% right figure with citation; 0 reads of a document the person cannot see (negative tests, revoked-grant test); 0 figures from highly confidential documents reaching a model (DECISIONS 46).
- **Migration:** likely (a stored table-object shape; additive). **Owner decision:** no.
- **Parallel:** with P4 and P5; it owns the contract change to PICTURE, so it coordinates with P4.

### Step P7 — Do the work in chat: research, discovery, comparison, memo

- **Goal:** "find me new companies", "research this market", "compare these four" and "write me a first-draft memo from this deck" all work from one ask in chat, with sources.
- **Build:**
  - Merge the `feat/q-web-discovery` lane first (mandate-driven multi-query, companies from directory pages, founders, sourced shortlist).
  - **Deep research from chat.** Q starts the existing `createDeepResearch` as a visible job with progress stages, and answers a quick first take while it runs. Results land as a sourced report artifact.
  - **Cross-check in chat.** `research_public_web` results go through `crossCheck`, so agreeing, contradicting and stale sources are shown side by side.
  - **Sentence-level citations** in chat answers built from web or documents: each sentence carries the source ids it rests on; code checks every id exists in the run.
  - **Comparison table with more columns:** web and data-room figures as extra columns, each cell with its source and truth class. Unknown cells say unknown.
  - **Memo from a deck in one ask:** routes to the existing diligence memo job (always the researched memo, DECISIONS 52).
  - Any outward step (contacting a founder) stays Prepare → Recommend → Approval → Execute.
- **Files:** `q-research/src/application/deep-research.ts`, `domain/cross-check.ts`, `q-tools/src/tools/research-public-web.ts`, `q/compare-table.ts`, `q-orchestrator/src/workforce/plan.ts`.
- **Bar:** DISCOVERY: 100% of named companies have a recorded source, 0 invented companies; every cited sentence's source id exists (code-asserted); comparison tables have 0 cells without a source or an explicit unknown; a deep-research job survives a q-api restart.
- **Migration:** no. **Owner decision:** search budget per job (existing DECISIONS 43 applies).
- **Depends on:** the web-discovery lane. **Parallel:** with P5, P6.

### Step P8 — Self-check and honest confidence on high-stakes answers

- **Goal:** comparisons, diligence, memos and recommendations are checked before they are shown, and confidence means something.
- **Build:**
  - For ANALYSIS, COMPARISON and DOCUMENT answers only: after the draft, a fast model pass checks each sentence against its cited facts and returns `SUPPORTED / UNSUPPORTED / OVERSTATED`. Code removes or softens anything not SUPPORTED. The deterministic claim check still runs first.
  - **Confidence from evidence, not self-report:** HIGH / MEDIUM / LOW computed by code from the evidence status and number of independent sources of the facts used. No invented percentages.
  - `insufficientEvidence` shown as "what would change my view" (the missing evidence), not hidden.
- **Files:** a new `q/self-check.ts`, `q/index.ts` (after draft, before publish), `q/result-blocks.ts`.
- **Bar:** a seeded set of 30 drafts with planted overstatements: ≥ 95% caught; 0 false removals of supported sentences in the clean set; added latency ≤ 1.5 s p95, only on those answer kinds.
- **Migration:** no. **Owner decision:** no (uses the existing confidential route).
- **Depends on:** P0. **Parallel:** with P6, P7.

### Step P9 — Voice as smart as chat

- **Goal:** voice gives the same answer as chat, never a looser one.
- **Build:**
  - The realtime model speaks Q's checked sentences **verbatim** when they carry a figure or a name; it may paraphrase only connective words. A code check compares spoken figures with the checked text.
  - Blocks chosen in voice turns go to the stage (P4), so "show me" works by voice.
  - Run Q-IQ through the duplex broker (text in, the same `ask_q` path) as a voice subject.
  - Verify the sideband live once and either turn it on or remove it.
- **Files:** `apps/web/.../duplex-line.ts`, `apps/q-api/src/voice/duplex/broker.ts`, `routing.ts`, `q-evals` runner.
- **Bar:** voice-subject Q-IQ within 2 points of chat and 0 invented figures; 0 spoken figures that differ from the checked text across the run.
- **Migration:** no. **Owner decision:** no.
- **Depends on:** P4. **Parallel:** with P7, P8.

### Step P10 — Briefing ranked by mandate

- **Goal:** when asked "what should I look at?" or in the Daily, Q leads with what matters to this person's declared mandate.
- **Build:**
  - Daily and attention ranking add one term: fit to the **declared** mandate (sector, stage, geography, cheque), from the versioned ranking config. Behaviour never rewrites the mandate. No clicks, opens or watch time in any ranking.
  - One "your brief" answer: new matches, changes to companies they track, items waiting on them, and Daily items, each with why it is there.
  - The Q page still opens clean (DECISIONS 54). The brief comes when asked, or by email or push only if the person opts in.
- **Files:** `q-daily/src/relevance.ts`, `q-tools/src/tools/attention.ts`, `web features/briefing/`.
- **Bar:** on a fixed fictional set, the top 5 items all match the declared mandate ≥ 90%; a unit test asserts no engagement field is read by ranking; push sends 0 messages to people who did not opt in.
- **Migration:** maybe (opt-in setting, additive). **Owner decision:** yes, proactive notifications.

### Step P11 — Measure in real use

- **Goal:** know how Q does with real people, not only on the benchmark.
- **Build:**
  - Thumbs up/down with an optional reason on every Q answer. Stored per owner, tenant-scoped, RLS, never used for ranking companies.
  - A weekly quality report: thumbs-down rate, ungrounded removals, clarifications, latency, by answer kind.
  - Every thumbs-down the owner reviews can become a Q-IQ case (fictionalised; never real customer data as a fixture).
  - Optional production sampling, only under the owner's consent decision.
- **Files:** `contracts/src/q/`, a migration under `supabase/migrations/`, `web features/q/`, `apps/q-api/src/http/`.
- **Bar:** feedback stored with positive, cross-tenant-negative and revoked tests; the weekly report runs on production; ≥ 10 new Q-IQ cases from real feedback.
- **Migration:** yes. **Owner decision:** yes, production sampling and consent.
- **Parallel:** any time after P0.

### Step P12 — Certification (the stopping point)

Three consecutive full runs meet every bar in section 3, and the owner's 20 live conversations cover every new capability. Recorded in `docs/specs/q-pitch/CERTIFICATION_MANIFEST.md`. All Q-IQ categories stay in CI, so a regression blocks deploys.

### Order and lanes

| Order | Step                      | Effort | Impact | Migration | Owner decision | Runs in parallel with |
| ----- | ------------------------- | ------ | ------ | --------- | -------------- | --------------------- |
| 1     | P0 Measure                | S      | High   | —         | —              | P1, P2, P3(1–2)       |
| 2     | P1 Reliability            | M      | High   | Yes       | Yes            | P0, P2                |
| 3     | P2 Know the person        | S      | High   | —         | —              | P0, P1                |
| 4     | P3 Speed                  | M      | High   | Yes       | —              | P1, P2 (items 1–2)    |
| 5     | P4 Presentation           | M      | High   | —         | —              | P5, P6                |
| 6     | P5 Calculators and charts | S–M    | High   | —         | —              | P4, P6, P7            |
| 7     | P6 Documents              | M      | Medium | Likely    | —              | P4, P5, P7            |
| 8     | P7 Work in chat           | M–L    | High   | —         | Budget         | P5, P6, P8            |
| 9     | P8 Self-check             | M      | Medium | —         | —              | P6, P7                |
| 10    | P9 Voice parity           | M      | Medium | —         | —              | P7, P8                |
| 11    | P10 Briefing              | S–M    | Medium | Maybe     | Yes            | any                   |
| 12    | P11 Real-use measurement  | M      | Medium | Yes       | Yes            | any after P0          |
| 13    | P12 Certification         | —      | —      | —         | —              | —                     |

Rules for the lanes:

- One owner at a time for the turn reader (P3 items 3–5, P4), for `contracts/src/q/result-block.ts` (P4, P6) and for each migration (P1, P3, P6, P11).
- Live runs use founder credit: stated, small, approved under DECISIONS 60, cost reported, and preceded by the P1 balance check.

## 3. Stopping point — "premium" in measurable bars

Done when **all** hold on three consecutive runs, plus the owner's 20 live conversations show no confusion, invention or wrong surface.

| Area         | Bar                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Conversation | Every `Q_INTELLIGENCE_PLAN.md` bar still holds; Q ≥ bare model in every category                                      |
| Honesty      | 0 invented figures, 0 wrong-entity answers, 0 invented companies, unknown said as unknown 100%, across all categories |
| Presentation | Right surface ≥ 95%; 0 visuals with an unsourced figure                                                               |
| Discovery    | 100% of named companies sourced; every cited sentence's source exists                                                 |
| Documents    | Right figure with citation ≥ 95%; 0 unauthorised document reads                                                       |
| Calculations | 100% exact, labelled, inputs sourced                                                                                  |
| Self-check   | ≥ 95% of planted overstatements caught; 0 false removals                                                              |
| Personal     | Stated preferences applied ≥ 95%; 0 inferences shown as stated                                                        |
| Speed        | First token p50 ≤ 1.5 s, p95 ≤ 4 s; follow-up first sentence p50 ≤ 2.5 s, p95 ≤ 6 s (production telemetry)            |
| Reliability  | Chaos test: ≥ 99% of turns answered or honestly degraded; alert ≤ 60 s; 0 ineligible confidential sends               |
| Voice        | Within 2 points of chat; 0 spoken figures differing from checked text                                                 |
| Briefing     | Top-5 mandate match ≥ 90%; 0 engagement inputs to ranking                                                             |
| Real use     | Thumbs-down rate reported weekly and not rising across the three runs                                                 |

## 4. Owner decisions

1. **Backup provider for confidential data.** Today only OpenAI may see CONFIDENTIAL context, so one empty balance takes Q down. Options: Groq zero-retention models (already contracted terms in `20260914090000`, weaker models); an Anthropic or Google enterprise route after a data-terms review. Needed for P1.
2. **Budgets and alerts.** A monthly model spend cap, the balance level that triggers an alert (suggest 7 days of spend), and who gets it. Also the live Q-IQ budget for the new categories (about $5 per full run, three runs).
3. **Proactive notifications.** May Q push a brief (opt-in, default off, at most one a day)? The Q page stays clean either way.
4. **Production quality sampling.** Whether, with what consent and for how long, real conversations may be sampled for review. Thumbs feedback works without it.
5. **Search providers.** Replace the ScrapingBee key and top up Serper, or retire them and rely on Brave and Tavily.
