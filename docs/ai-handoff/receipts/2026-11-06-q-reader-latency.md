# Q reader latency (step 11 follow-up): receipt, 2026-11-06

Branch `feat/q-reader-latency`, cut from `origin/fix/resume-asking-cv9ru3` @ `1ef895999` (step 10 merged).

All work was local:

- no hosted database, no migration written, no deploy;
- no live model or provider calls (every provider key was `disabled-locally-000000000000`).

The integration owner merges, runs CI and deploys.

## The problem (production, live18, 06 Nov 03:31 UTC)

| Turn            | readMs (turn reader) | first sentence since message |
| --------------- | -------------------- | ---------------------------- |
| Loan book       | 4,894                | 6,205                        |
| PAR30 follow-up | 3,881                | 4,417                        |

The reader is 79–88 % of the time to the first sentence. Only 0.5–1.3 s comes after it. The bar is p50 ≤ 2.5 s and p95 ≤ 6 s.

## What was measured (offline, through the real runtime)

### The reader's model, tier and reasoning

- **Task class:** `FAST_CLASSIFICATION`, reasoning `LOW`, two attempts, 9 s per attempt, and a same-model hedge at 3.5 s (`turn-reader.ts`).
- **Routing:** `fast_classification.v1` prefers gemini-3.5-flash-lite, then gpt-5.6-luna and gemini-3.5-flash (20261110000000).
- **A real customer's turn is `CONFIDENTIAL`.** Both Gemini models are PUBLIC, so **only gpt-5.6-luna may read it**.
  - A smaller or faster tier is therefore not available without a new provider review, which is an owner decision.
  - The tier is not the lever.
- **Production evidence in the code** (`turn-reader.ts`, `turn-reader.v68.ts`):
  - latency follows the output at about 9–10 ms a token over about 270 output tokens, and a reasoning model's thinking counts as output;
  - v68 already stopped default-valued fields being written.

### The reader's prompt (new harness, `q-evals/src/dev/q-reader-latency.ts`)

The reader prompt was captured from Q-IQ conversations run through the runtime with the reader on (it is off in step 11's `q-speed`).

| Part                                                                  | Characters | ≈ tokens   |
| --------------------------------------------------------------------- | ---------- | ---------- |
| System (charter, communication guidance)                              | 6,923      | 1,700      |
| Reader rules (template before MESSY WORDS)                            | 54,258     | 13,500     |
| Messy words, actions, page controls                                   | 4,397      | 1,100      |
| Per-turn input (state, recent turns, shown, utterance) in a Q-IQ turn | ~2,000     | ~500       |
| **Whole prompt (p50)**                                                | **67,277** | **16,800** |

The part a prefix cache could not reuse from the previous reading in the same conversation: **p50 492 tokens**, p95 16,807 tokens (a conversation's first reading, cold) — 82 readings over 20 cases.

How to read this:

- **About 92 % of the reader's input is fixed rules,** and that part is one cacheable prefix (step 1 and v68 put every per-turn input after it).
- **The recent-turns and state caps are not the cost.** v76 allows 16 turns × 1,600 characters, plus 8,200 characters of state and 9,000 shown. A long conversation adds at most about 10k tokens, all in the uncached tail. Trimming them would lose binding context for little gain.
- **The reader's time is decode, not input:**
  - roughly 270 output tokens, reasoning included, at about 9 ms each;
  - on a mostly cached prefix.
- **The two levers on the reader call itself:**
  - its **reasoning level** (LOW → NONE removes the thinking tokens);
  - the reader's **rules** (54k characters). Trimming them is prompt work that needs live reader evals.
- **Neither can be validated offline,** so neither was changed here (see "Proposed").

## What changed

### 1. The reading starts beside the database lanes (`q-specialists/src/answer.ts`)

**Before:** with no early reading (ADR 0035) in flight, the reader started only after every code lane had run. The early reading is missed on a person's first turn in a process (no action list known yet) and whenever the page's action list changed. The lanes that ran first:

- free lanes: ordinal recall, pointed record, page control, cards, screen act;
- database lanes:
  - a tab by name;
  - a record by name (their counterparts, then `open_page`'s resolve);
  - a researched entity by name (the finder).

**Now:**

- The reading starts as soon as its inputs exist (words, turns, actions, shown, pointing), after the free lanes and **beside** the database lanes.
- It is not started when the code-only page lane will answer the turn alone (a page by name with nothing more asked), so code-answered turns still make **no reading**. The `turn-latency` "0 model calls" tests are unchanged and pass.
- A lane that answers the turn stops it: the run's end aborts `readerAbort`, which is registered per run, bounded and LRU.
- Nothing of the reading is used until the turn reaches it, exactly as before. An early reading with the same actions is still taken up.
- New log field on "q turn timing": `readerHeadStartMs`, how long before the answer needed the reading it had already started.

**Production effect:**

- On a turn that names a record ("How big is Ledgerfold's loan book?"), the reading no longer waits for those lanes' database round trips: counterparts, the open-page resolve, the researched-entity finder.
- On a plain question with no name, those lanes make no read, so nothing changes.
- On Railway → Supabase that is a few round trips; read `readerHeadStartMs` after deploy.

### 2. Speculation never adopts an answer the reading changed (`q-specialists/src/speculation.ts`)

There is a latent defect in voice speculation (latency2), found while weighing typed-turn speculation:

- **Lost binding:**
  - The turn's own answer is given the reference binding by `withReferences`.
  - The speculative answer begins before the binding and never has it.
  - `speculationMisfit` did not check it, so an adopted spoken answer could miss what "it", "her" or "the second one" meant.
- **Unchecked v78 fields:** `answerKind` (task class and reasoning), `askParts`, `rememberAsk`, `asksForChart`, `asksForWeb`, `preparedSubject` and `namedOther` were not compared either.

Fix:

- **`BOUND`** (new reason): the run bound the words (the reader's references, or code's own pointing), or the final request carries `references` or `referencedCompanyIds`. Also checked in `readingMisfit` the moment the reading lands.
- **Reading fields compared whole** (absent, null and false are equal): the list above. A field added to the reading must be added to `READING_FIELDS`.
- The voice speculation now asks for `answerKind: LOOKUP` (`SPECULATIVE_ANSWER_KIND`), so a v78 lookup reading can still be adopted. Any other kind cancels it.
- `questionKind` keeps the voice lane's existing rule (ADVICE and THEIR_OWN_RECORDS cancel).
  - **Flagged for the voice lane:** `questionKind` also chooses `answerPathOf` routes (TARGETED_RETRIEVAL) and `fit-integrity` treats an absent kind differently.
  - An exact match would be the fail-safe rule, at the cost of most spoken adoptions.

### 3. The reader's reasoning level can be set as versioned data (`model-gateway/src/q/turn-reader.ts`)

- The reader names `reasoningKey: "TURN_READER"` (`TURN_READER_REASONING_KEY`), as the answer does per answer kind (step 7).
- **No behaviour change:** no policy lists the key, so `LOW` stands (`reasoningUnderPolicy`).

### 4. Measuring harness (offline, no cost)

- **`model-gateway` fake provider, `ROUTED` behaviour:** one script answers by request, e.g. the reader's schema one way and the answer another, each with its own delay.
- **`q-evals/src/dev/q-reader-latency.ts`:** Q-IQ through the real runtime with the **reader on**.
  - The reader answers a neutral reading after `--reader-ms` (default 4,000).
  - The answer's first words come after `--answer-first-ms` (default 1,500).
  - Optional `--reader-per-input-token-ms` adds delay per uncached input token.
  - It prints p50/p95 of the production log fields and the reader prompt's size, whole and uncached.

  ```
  DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
    node packages/q-evals/dist/dev/q-reader-latency.js --limit 20 --out f.json
  ```

## Before / after (harness, 20 Q-IQ cases, local PG 16, reader 4,000 ms, answer first words 1,500 ms)

"Before" is this branch with `answer.ts` and `speculation.ts` at the base (the harness is new, so it cannot run on the base itself). Figures are p50 / p95 in ms.

| Stage (82 turns)                                     | Before          | After           |
| ---------------------------------------------------- | --------------- | --------------- |
| Reader (`readMs`)                                    | 3,999 / 4,004   | 3,998 / 4,008   |
| Message → routing done (`sinceMessageMs`)            | 4,024 / 4,039   | 4,022 / 4,034   |
| Model's first words (`firstTextMs`, from seam start) | 1,506 / 1,511   | 1,506 / 1,511   |
| **First words since message** (joined per run)       | 5,530 / 5,548   | 5,529 / 5,542   |
| First sentence since message (streamed, n=5)         | 5,535 / 5,539   | 5,536 / 5,538   |
| Message → answer settled (`totalSinceRunMs`)         | 5,542 / 5,567   | 5,542 / 5,557   |
| Reader prompt (est. tokens)                          | 16,856 / 16,970 | 16,856 / 16,970 |
| Q-IQ score                                           | 1.0             | 1.0             |

What this does and does not show:

- **The harness puts the reader on the path, as production does.** With reader 4.0 s and answer first words 1.5 s, the first words since the message are about 5.5 s, matching production's 4.4–6.2 s.
- **Loopback is sub-millisecond, and the Q-IQ world composes no record or entity lanes.** So the database time the reading now runs beside is not in these figures: no regression, no gain shown.
- **The ordering is proven by tests** (below), and the production gain is read from `readerHeadStartMs`.

## Tests

| File                                                          | Covers                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q-specialists/test/turn-reader-early-start.test.ts` (2, new) | The reading is under way before the record-by-name lane's read lands, and is the one reading the answer takes. A lane that answers the turn aborts it. **Both fail on the base and pass here.**                                                  |
| `q-specialists/test/speculation-misfit.test.ts` (+3)          | Bound references → BOUND. ANALYSIS, COMPARISON, DOCUMENT or no answerKind → NOTE. A compound ask → NOTE. A LOOKUP plain question is still adopted.                                                                                               |
| `q-specialists/test/answer-speculation.test.ts` (+2)          | Through the seam: an ANALYSIS reading discards the speculation unheard and the turn's own answer carries ANALYSIS. A reading with references never lets the speculative answer be heard or stored. The v78 plain question is adopted, said once. |
| `model-gateway/test/turn-reader-posture.test.ts` (+1)         | The reader names `TURN_READER` and asks LOW by default.                                                                                                                                                                                          |

## Proposed (not written; for the lead)

1. **Reader reasoning NONE through the routing config.** This is the likely largest single cut on the reader: its thinking tokens, at about 9 ms each. A one-line additive data migration plus a pgTAP assertion beside `999_ai_ops_routing_reasoning_levels.test.sql`:

   ```sql
   update ai_ops.routing_policies
      set reasoning_levels = coalesce(reasoning_levels, '{}'::jsonb)
                             || jsonb_build_object('TURN_READER', 'NONE')
    where status = 'ACTIVE' and code = 'fast_classification.v1';
   ```

   - It needs a live reader eval first (`apps/q-api/src/dev/reader-eval.ts`, references, answerKind and parts), because the reader decides binding.
   - Rollback is the same statement with `'LOW'`.

2. **The reader's rules (54k characters, ~13.5k tokens)** are the prompt's bulk. A pass that removes superseded versions' rules needs live reader evals.
3. **Typed-turn speculation** was weighed and not built. The reading's `questionKind`, `answerKind` and bound references choose the answer's path, task class and prompt, so a speculation begun before the reading can be adopted only when all of them match. Both live18 turns carried a question kind. A miss costs a full answer, ~44k input tokens. The most it could save is the 0.5–1.3 s after the reader.
4. **Early reading on a person's first turn in a process.** Today it needs the action list remembered from their last turn here. Starting it from the early firewall plan (`earlyPlans` in `q-orchestrator/src/graph.ts`) would move the reader's start to the end of preflight on every turn. That is an orchestrator and runtime port change, for the integration owner.

## Gates (exact results)

GATES
