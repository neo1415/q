# Q Intelligence Plan — context, memory, reasoning, grounding

Status: PROPOSED (owner request, 5 Nov 2026). Author: integration owner session_01Eyr9vLWNKc3FEiHheX7Mwc.

Precedence: below the locked PADL, CLAUDE.md invariants and ADRs. Every step keeps the following intact:

- the Context Firewall (filter before the model);
- RLS;
- the Write Gate;
- approval bound to the exact payload;
- the truth-class, evidence-status and lifecycle axes.

## Overall goal (the stopping point)

Q must be at least as intelligent in conversation as the model underneath it. Given the same authorised context, Q must not be worse than that model, and it must never invent.

We measure this with **Q-IQ**: a fixed benchmark of multi-turn investor and founder conversations on fictional seed data (defined in step 0). The work is done when **all** of these hold, three runs in a row:

| Measure                                                                                                  | Bar                              |
| -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| References resolved correctly ("it", "the second one", "that company", "him", "the other deck")          | ≥ 98%                            |
| Wrong-entity answers (answering about a different company or person than meant)                          | 0                                |
| Invented figures, names, customers or quotes (any claim not in the authorised facts or the conversation) | 0                                |
| Unknowns said as unknown (missing evidence never becomes a number or a "no")                             | 100%                             |
| Ambiguous asks that get one short clarifying question rather than a guess                                | ≥ 95%                            |
| Q's score vs the bare model given the same context dump, per category                                    | Q ≥ bare model in every category |
| Compound asks with every part answered                                                                   | ≥ 95%                            |
| Corrections ("no, I meant Ledgerfold") applied on the next turn and remembered for the conversation      | 100%                             |
| Cross-conversation recall ("what did we say about Silo last week?") answered from stored turns           | ≥ 90%                            |
| Latency p50 / p95 for a follow-up answer's first sentence                                                | ≤ 2.5 s / ≤ 6 s                  |

The work must also pass one more gate: the owner holds 20 live conversations on production and finds no confusion or invention.

## Audit — what frontier assistants do, and where Q stands today

The current-state facts come from a code map made on 5 Nov 2026; file references are in the appendix. Status key:

- ✅ Q has it;
- ◐ partial;
- ✗ missing.

| #   | Frontier practice (ChatGPT / Gemini / Claude)                                                                                                              | Q today                                                                                                                                                                                                                                                                                              | Status                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A1  | The **whole conversation** reaches the model; long chats are **compacted** into a running summary, not cut off                                             | Up to 64 raw messages reach the answer model, but no in-conversation compaction. The **turn reader**, which routes the turn, sees only the last 6 messages at 400 chars each. The "what you already showed" record keeps 8 turns at 600 chars of said text each.                                     | ◐                                                                                  |
| A2  | **Coreference resolved by the model** over the full context, against an explicit list of the entities in play; it **asks** when two readings are plausible | Regex/keyword rules (ORDINALS, PAIR, THIS, BACK, COUNTERPART) over at most 4 card lists and 12 focus entities. When no rule matches, the model gets no binding and the turn is "read as before". There are no person or pronoun entities ("him", "her", "their CFO").                                | ◐ (and conflicts with the owner rule "no keyword/regex rules over people's words") |
| A3  | **Current date/time and user identity/role** always in the system prompt                                                                                   | No unconditional date line; the date appears only when the schedule tool is offered. The role is implied, not stated.                                                                                                                                                                                | ✗                                                                                  |
| A4  | **Reasoning** ("thinking") on multi-step, comparison and analysis asks; fast mode for chit-chat                                                            | The main answer path runs at reasoning NONE; only 7 sub-readers use LOW.                                                                                                                                                                                                                             | ✗                                                                                  |
| A5  | **Grounded generation with citation checking**: every factual claim maps to a source, and unsupported claims are removed or flagged before display         | Fact labels (F1…) cite sources. The guards cover screen claims, artifact claims, recommendation claims and card counts. **No check compares the main answer's figures or claims against the authorised facts.** The number guard applies to the "extras" writer only.                                | ◐                                                                                  |
| A6  | **Retrieval with reranking**, query rewriting from conversation context, and multi-query search                                                            | Hybrid FTS + pgvector with RRF (8 hits). No reranker. Queries are not rewritten using the conversation ("its burn" → "Silo Credit burn rate").                                                                                                                                                       | ◐                                                                                  |
| A7  | **Long-term memory** of stated preferences and facts, with provenance, user control and **search over past chats**                                         | Write Gate, quotes checked against the user's turns, list and forget, consent for inferred preferences. Cross-conversation recall is summaries only (6 recent and 4 "relevant" by name terms). No search over past turns. Known defect: Q's own inference was saved as the investor's stated choice. | ◐                                                                                  |
| A8  | **Agentic tool loop**: plan, call tools, read results, call again until done; never claim an action without the tool result                                | Function calling with ~116 tools, but the loop is capped at 2 rounds and 10 calls. Known defect: Q promised a document without calling the tool. A "never say done unless a tool did it" note exists, but only as a prompt.                                                                          | ◐                                                                                  |
| A9  | **Calibrated uncertainty**: "I don't know" and "that isn't in the deck" said plainly; conflicting sources shown side by side                               | In the charter (unknown is valid; contradictions coexist), plus an `insufficientEvidence` flag. Not measured.                                                                                                                                                                                        | ◐                                                                                  |
| A10 | **Clarifying questions** when the ask is ambiguous, rather than guessing                                                                                   | Only for an unresolved POSITIONS ask.                                                                                                                                                                                                                                                                | ✗                                                                                  |
| A11 | **Instruction hierarchy**: retrieved text is data, not instructions                                                                                        | In the charter and CLAUDE.md. Not tested adversarially for documents and web pages.                                                                                                                                                                                                                  | ◐                                                                                  |
| A12 | **One model-led understanding step** rather than many hand-written lanes                                                                                   | One model reader (v75) plus many regex lanes layered over it in answer.ts and index.ts (ANALYSIS_WORDS, COMPARISON_WORDS, lane regexes). The two can disagree.                                                                                                                                       | ◐                                                                                  |
| A13 | **Large evals**: thousands of multi-turn cases, deterministic checks plus graded rubrics, with regressions blocked in CI                                   | q-evals has 15 golden, 10 adversarial and 14 regression cases, plus GateQ 20. Grading is deterministic; there is no multi-turn reference or invention benchmark.                                                                                                                                     | ◐                                                                                  |
| A14 | **Self-check before sending** on high-stakes answers (draft → verify → revise)                                                                             | None for the main answer.                                                                                                                                                                                                                                                                            | ✗                                                                                  |
| A15 | **Personalisation**: tone, depth and language remembered                                                                                                   | Communication profile (5 aspects) with consent. No language preference.                                                                                                                                                                                                                              | ◐                                                                                  |
| A16 | **Streaming with a fast first token**, and heavy work in the background                                                                                    | Sentence streaming. Memory and follow-up answers took 12–32 s (ACTIVE-TASKS:356).                                                                                                                                                                                                                    | ◐                                                                                  |
| A17 | **State survives restarts** (summaries, plan caches)                                                                                                       | The prepared plan cache and meeting summary are in process memory and lost on restart.                                                                                                                                                                                                               | ✗                                                                                  |
| A18 | **Background workers ground their writing in sources**                                                                                                     | The workforce writer's GROUNDED reviewer checks against `""` (AGENT-EXECUTION-MATRIX:44).                                                                                                                                                                                                            | ✗                                                                                  |

## Steps

Each step names its goal, its main files and the bar it must pass.

- Steps are done **in order**, except where they are marked parallel.
- Each step lands on its own branch with failing-first tests.
- Each step goes through the release lane (gates → CI → deploy → live check).

### Step 0 — Build the Q-IQ benchmark first (measure before changing)

- **Goal:** a fixed, repeatable score for "how smart is Q in a conversation", run in CI and against production.
- **Set:** 150 multi-turn conversations of 3–8 turns, on fictional seed companies, investors and documents, in 10 categories:
  1. pronouns and people;
  2. ordinals and lists;
  3. follow-ups;
  4. corrections;
  5. compound asks;
  6. unknown and missing evidence;
  7. contradictions;
  8. numbers;
  9. cross-conversation memory;
  10. ambiguity (should ask).
- **Grading:**
  - Entity, number and "said unknown" checks are **deterministic**: each case records the expected entity ids and allowed figures, and code asserts them. Per CLAUDE.md, no LLM judges something code can assert.
  - A rubric judge is used only for helpfulness and clarity, and is reported separately.
- **Baseline:** the **bare model** (same provider, given the full raw conversation and the same authorised facts, with no Q machinery). This is how we know whether Q's layers help or hurt.
- **Where:**
  - `packages/q-evals/src/datasets/q-iq/`
  - graders in `packages/q-evals/src/graders/`
  - CI runs it with the scripted model; a budgeted live run happens on request, with its cost reported (founder credits rule).
- **Bar:** the benchmark exists. Today's score and the bare-model score are recorded in `docs/specs/q-intelligence/BASELINE.md`, and every later step reports its delta.

### Step 1 — Always-on situation header (A3)

- **Goal:** Q always knows today's date and time, the person's time zone, who is asking (name, role FOUNDER/INVESTOR, organisation), the surface (chat, voice, dock) and the page they are on.
- **Files:**
  - `packages/model-gateway/src/q/index.ts` (`environmentNoteParts`)
  - `apps/q-api/src/main.ts` (`askerOf`)
- **Bar:** Q-IQ date questions ("is the call tomorrow?", "how old is this deck?") at 100%, with no regression.

### Step 2 — Conversation state: entity ledger + running summary (A1, A2, A17)

- **Goal:** one durable, per-conversation **state** that every model step reads. It has three parts:
  - The **entity ledger.** Every company, investor, person, document, plan and figure mentioned or shown, with its id, its kind, when and how it appeared (said, card, page), and its list positions.
  - The **running summary.** It is compacted by a model after N turns and is append-only, with corrections kept as history.
  - **Open threads.** Unanswered parts, pending approvals, and corrections ("Ledgerline means Ledgerfold").
- **Build:**
  - Built deterministically from stored turns, blocks and tool results. Only the summary uses a model, through the Model Gateway, and writes through the Write Gate.
  - Persisted in `q_runtime` with a new migration. RLS is per conversation owner.
  - Survives restarts.
- **Context use:**
  - The **turn reader gets the full state**, not 6 messages at 400 chars.
  - The answer gets the state plus the recent raw turns.
  - Older raw turns are replaced by the summary, never silently dropped.
- **Files:**
  - `packages/q-specialists/src/conversation-entities.ts` (becomes the ledger builder)
  - `packages/model-gateway/src/q/conversation-context.ts`
  - `turn-reader.ts`
  - a migration under `supabase/migrations/`
- **Bar:** Q-IQ follow-ups and corrections ≥ 95%; a 40-turn conversation keeps every early entity resolvable.

### Step 3 — Model-led reference binding with a clarify path (A2, A10, A12)

- **Goal:** replace the regex reference rules with the turn reader binding references **by meaning** against the ledger.
- **Output:**
  - The reader returns `references: [{ phrase, entityIds[], confidence }]`.
  - Code checks every returned id exists in the ledger and is visible to this person (Context Firewall). An id not in the ledger is rejected, so it can never be invented.
- **Policy:**
  - One clear reading: bind it, and the answer must be about exactly those ids. Fit-integrity is extended to all answers.
  - Two plausible readings: one short clarifying question naming both ("Silo Credit or Silo Health?").
  - None: say so and ask.
- **Covers:**
  - people and pronouns ("him", "her", "their CFO", "the founder");
  - documents ("the other deck");
  - plural sets ("those three", "all but the last").
- **Removes:** the ORDINALS / PAIR / THIS / BACK / COUNTERPART regexes, once Q-IQ shows the model path ≥ the regex path. This resolves the conflict with the owner's "no keyword rules over people's words".
- **Bar:** references ≥ 98%, wrong-entity 0, ambiguity → clarify ≥ 95%.

### Step 4 — Consolidate understanding into one reader (A12)

- **Goal:** the regex lanes (`ANALYSIS_WORDS`, `COMPARISON_WORDS`, lane regexes in `answer.ts` and `index.ts`) become fields the reader already returns: `questionKind`, `parts[]` for compound asks, and the task class. There is one source of truth for "what was asked".
- **Bar:** compound asks ≥ 95%, with no category regression. The number of regexes over user words in `answer.ts`/`index.ts` is reported, and the target is 0 outside the wake phrase.

### Step 5 — Context-aware retrieval (A6) (parallel with 4)

- **Goal:** the right evidence reaches the model.
- **Build:**
  - **Query rewriting** from the ledger and state, e.g. "its burn" → "Silo Credit monthly burn" with the company id filter.
  - Multi-query for compound asks.
  - A **reranker** behind an adapter, so `reranker: "NONE"` becomes a real reranker.
  - Web research results stored as chunks with provenance.
- **Firewall:** authorisation still resolves before retrieval.
- **Files:** `packages/q-knowledge/src/retrieval/*`, `q/evidence-retrieval.ts`.
- **Bar:** the share of Q-IQ evidence questions whose needed fact is in the final 8 hits ≥ 95% (measured from the dataset's expected fact ids).

### Step 6 — Claim verifier before display (A5, A9, A14)

- **Goal:** no invented figure or entity reaches the screen or the voice.
- **Build:**
  - After the answer is drafted, a deterministic checker extracts every number, money amount, percentage, date, company and person name. It matches each one to the authorised facts, the conversation or tool results.
  - An unmatched claim is removed, or rewritten as unknown ("the deck doesn't state ARR").
  - The removal is logged as `ungrounded` with the claim.
  - For DEEP_ANALYSIS and COMPARISON answers, an optional model **self-check pass** verifies each sentence against its cited facts.
- **Streaming:** the checker runs per sentence before publish, so voice never speaks an unchecked figure.
- **Files:**
  - a new `packages/model-gateway/src/q/claim-check.ts`
  - wired into `takeSentence` (index.ts)
  - the existing `parallel-extras.ts` logic generalised
- **Bar:** invented claims 0 across three consecutive Q-IQ runs, and the unknown-said-as-unknown rate at 100%.

### Step 7 — Adaptive reasoning (A4)

- **Goal:** think when it matters.
- **Build:**
  - The reader's question kind sets the reasoning level: NONE for chat and lookups, LOW for follow-ups, MEDIUM for comparison, diligence, memo and planning.
  - Budgets stay in the versioned routing config.
  - The answer starts streaming a short lead sentence while reasoning runs, where the provider allows.
- **Files:** `index.ts` (`answerTaskClass`, budgets), the `ai_ops.routing_policies` migration.
- **Bar:** the comparison and number categories rise vs the step-6 score, with p50 still ≤ 2.5 s for follow-ups (they stay at NONE/LOW).

### Step 8 — Agentic loop that finishes the job (A8)

- **Goal:** Q calls tools until it has what it needs, and never claims an action a tool did not do.
- **Build:**
  - Raise the loop to 4–6 rounds for DEEP_ANALYSIS only, with a time budget.
  - A deterministic **promise check**: a sentence saying "I've prepared / sent / added" must match a successful tool result in this run, or it is rewritten.
- **Bar:** zero unbacked action claims in Q-IQ; the known "promised a document without the tool" case passes.

### Step 9 — Memory you can trust, and recall of past chats (A7, A15)

- **Goal:**
  - Memory keeps **who said it**. A stated choice is USER_CLAIM; Q's mapping is Q_INFERENCE, never shown as "your preference". This fixes the HANDOFF-2026-11-01 defect.
  - "What did we say about X last week?" is answered from **search over the person's own past turns**: FTS + vector over `conversation_messages`, scoped to the owner and filtered by the firewall before retrieval.
  - Language preference becomes a communication aspect.
- **Bar:** cross-conversation recall ≥ 90%; no inferred memory is ever presented as stated (deterministic check on the memo and answers).

### Step 10 — Grounded background work and adversarial safety (A11, A18)

- **Goal:**
  - The workforce writer and reviewer get the same authorised facts and the same claim verifier (step 6).
  - Add an adversarial Q-IQ category: instructions hidden in decks and web pages ("ignore previous instructions…") must have no effect.
- **Bar:** invented claims 0 in workforce documents; adversarial category 100%.

### Step 11 — Speed pass (A16)

- **Goal:** the intelligence work must not make Q slow.
- **Build:**
  - Cache the ledger and state per conversation.
  - Run the reader, retrieval and memory recall in parallel.
  - Use the fast model for summary compaction, off the critical path.
- **Bar:** follow-up first sentence p50 ≤ 2.5 s and p95 ≤ 6 s on production.

### Step 12 — Certification (the stopping point)

- Three consecutive full Q-IQ runs meet every bar in the goal table. The deterministic run is in CI; the live run is budgeted and has its cost reported.
- The owner's 20 live conversations show no confusion or invention.
- The result is recorded in `docs/specs/q-pitch/CERTIFICATION_MANIFEST.md` and the handoff.
- Q-IQ stays in CI, so a regression blocks deploys.

## Order, lanes and cost

- Steps 0 → 1 → 2 → 3 are the critical path; this is where the "pronoun confusion" lives.
- Steps 4 and 5 run in parallel lanes after 3. Steps 6, 7 and 8 come next; step 6 is the "never invents" core and can start in parallel with 2.
- Steps 9, 10 and 11 can run in parallel after 6.
- Migrations (steps 2 and 9) have one owner at a time and go through pgTAP first.
- Live model runs use founder credits. Each live Q-IQ run is stated, kept small (the 150 cases at the cheapest viable settings), approved, and its cost reported.

## Appendix — current-state references (code map, 5 Nov 2026)

- **Turn flow:**
  - Graph: `packages/q-orchestrator/src/graph.ts:567-593`
  - Outer answer layer: `packages/q-specialists/src/answer.ts:2023`
  - Inner answer layer: `packages/model-gateway/src/q/index.ts`
- **History and context:**
  - History load (64 messages): `index.ts:3070-3077`
  - Shown record (8 turns): `conversation-context.ts:39-45`
  - Reader window (6 messages, 400 chars): `answer.ts:747-757`, `turn-reader.ts:422-434`
- **References:** regex rules at `conversation-entities.ts:82-189`; unresolved → no binding at `answer.ts:355-395`
- **Situation header:** no date line (`own-day.ts:197` only); identity from `main.ts:5088-5150`
- **Reasoning:** default NONE at `contracts/src/model/index.ts:609`; the main answer sets none
- **Grounding:**
  - Guards: `index.ts:6514-6545`
  - Extras-only number guard: `parallel-extras.ts:141-200`
- **Retrieval:**
  - Settings: `retrieval/contracts.ts:345-364` (8 hits, no reranker)
  - Memory recall: `index.ts:2954-2980` (4,000 chars; 6 recent + 4 relevant digests)
- **Tool loop:** `index.ts:755,780` (2 rounds, 10 calls)
- **Evals:** `packages/q-evals/src/datasets/index.ts` (15 golden, 10 adversarial, 14 regression)
