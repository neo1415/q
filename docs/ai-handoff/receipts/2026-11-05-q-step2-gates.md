# Q Intelligence step 2 gates — 2026-11-05

Branch `feat/q-conversation-state`. Base: WIP `a94d1458b` merged with `origin/fix/resume-asking-cv9ru3` (clean merge; it also brought the q-evals Q-IQ reporter changes). Local only: no hosted DB, no deploy, no live model calls (provider keys `disabled-locally-000000000000`).

## Fixes made to reach the gates

- `q-specialists/test/answer-conversation-state.test.ts`: removed an unused import (root tsc TS6192).
- `q-specialists/src/conversation-ledger.ts`: the block-kind switch now lists the non-folded kinds instead of `default` (lint `switch-exhaustiveness-check`), so a new block kind forces a decision there.
- `q-runtime/src/infrastructure/postgres-conversation-states.ts`: `isoOf` no longer stringifies an unknown object (lint `no-base-to-string`); anything other than Date, string or number reads as null.
- `q-specialists/src/answer.ts`: the answer gets the conversation-state note only when the ledger, open threads or summary hold something. A first turn's empty ledger was sent as a note to every answer. The reader still always gets the text.
- `apps/q-api/test/plan-live-1.test.ts`: active TURN_READER pin 75 → 76 (the WIP bumped the prompt but missed this pin).
- `q-orchestrator/test/answer-seam.integration.test.ts`: **pre-existing on base.** Step 6 (`5bc0f39`, live) added an always-on `CONVERSATION_FINDINGS_NOTE` SYSTEM message, but the expected message roles in this test weren't updated. The expectations now include it.

## Gate results (final tree of the step-2 commit)

| Gate                                                                          | Result                                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec turbo run build --filter=./packages/*`                             | 54/54 successful                                                                                                                                               |
| root `tsc --noEmit -p tsconfig.json`                                          | exit 0                                                                                                                                                         |
| `apps/q-api` tsc                                                              | exit 0                                                                                                                                                         |
| `apps/web` tsc                                                                | exit 0                                                                                                                                                         |
| eslint, run per directory (all at once OOMs at 6 GB)                          | 0 problems in q-api, model-gateway, q-actions, q-core, q-evals, q-orchestrator, q-runtime and q-specialists                                                    |
| vitest (default config), q-api + 7 touched packages                           | 766 files passed and 2 skipped; 7235 tests passed and 4 skipped                                                                                                |
| vitest integration, the 10 touched `*.integration.test.ts`, local PG 16       | 99/100. Only failure: `q-iq.integration` one-per-category, `QIQ-NUM-106#2`. It is **pre-existing**: same `score toBe(1)` assertion on base, same claim refusal |
| `npx prettier --check apps packages docs supabase`                            | clean                                                                                                                                                          |
| pgTAP `999_q_conversation_state.test.sql` (local PG, all migrations)          | 28/28 ok                                                                                                                                                       |
| `scripts/local-pg/setup.sh` (every migration applied, incl. `20261231250000`) | ready                                                                                                                                                          |

The integration runs need `DATABASE_URL` set as well as `CQ_TEST_DATABASE_URL`. The Q-IQ world's LangGraph checkpointer reads `CQ_EVAL_DATABASE_URL` / `DATABASE_URL` and otherwise defaults to port 54322. Without it, every run fails with ECONNREFUSED and "(no reply)".

## Scripted Q-IQ, all 150 cases (`CQ_Q_IQ_ALL=1`, FAKE provider)

- Result: 554/573 turns (0.9668).
- The 19 failures are the same as the WIP's base and branch runs:
  - NUM-106…120 #2 (and 108 #4, 118 #4);
  - MEM-134 #0 and MEM-135 #0.
- All 19 are the claim check refusing derived arithmetic ("$180k a month" → "$2.16M a year"). That predates step 2; item 5 of the plan targets it.

Not done here: CI pgTAP on the Supabase stack, any hosted migration apply, or deploy. Those belong to the integration owner.

## Item 5: claim check grounds derived arithmetic within one sentence (own commit)

`packages/model-gateway/src/q/claim-check.ts`. A derived figure can now also use two more kinds of input, as long as the sentence itself says them:

- **A period conversion.** "$180k a month is $2.16M a year" names a month and a year, so ×12 can be used. Also quarter/year ×4, week/year ×52 and month/quarter ×3.
- **A short duration the sources state.** In "9 months at $120k a month", the lone digit is still not checked as a claim, but it can be an input.

Still ungrounded:

- "Annual burn is $1.02M": the input isn't in the sentence.
- A wrong product.
- An unsourced monthly input.
- An unsourced duration.

Tests are in `packages/model-gateway/test/claim-check.test.ts`, 22/22.

Results:

- Scripted Q-IQ, all 150 cases: **554 → 571/573**.
- The default one-per-category Q-IQ integration test now passes, 1/1.
- model-gateway, q-specialists and q-api vitest: 6106 passed.
- Root tsc exit 0; eslint and prettier clean.

The two left, MEM-134 #0 and MEM-135 #0, aren't arithmetic. The cheque size was said in a previous conversation, and the scripted world has no cross-conversation recall (plan step 9). The other three MEM cheque cases pass only because their amounts happen to appear elsewhere in the fixture corpus.

## Step 3: model-led reference binding (`f5a6c09`)

**Reader (TURN_READER v77).** v76 is kept whole, plus one REFERENCES rule. Output: `references: [{phrase, entityIds, confidence}]`.

- `entityIds` are LEDGER refs (E1…), never record ids. Code maps refs to records.
- `confidence` is HIGH, MEDIUM or LOW; never a percentage.
- A plural set is one entry. Two plausible readings are two entries with the same phrase. "Nothing fits" is an entry with no refs.
- It covers pronouns, people by role, documents ("the other deck"), places in a list and sets.
- prompts.lock gains only `turn-reader/v77`; v76's hash is unchanged.

**Code (`packages/q-specialists/src/reference-binding.ts`, wired in `answer.ts` after the reading).**

- **Context Firewall.** Every ref is checked against the exact state rendered for the reader: the stored owner-only ledger plus only the reads the firewall kept for this run. A reading with any ref outside it is refused whole and logged.
- **One reading** binds. It replaces the word-pattern note for the answer, and a set of two or more companies sets `referencedCompanyIds`.
- **Two readings** get one short question naming both ("By "it", do you mean Silo Credit or Ledgerfold?"). One HIGH reading among guesses binds instead.
- **None**: Q says so and asks. The exception is words code already bound to their page (a manifest list or control), which the ledger doesn't hold. A code guess from conversation focus ("email her" → last company) never outvotes the reader's "nothing fits".
- **A reply to a waiting card** is never decided here; the card's exact payload governs.
- Binding grants nothing: tools still authorize every read and act.

**Gates on `f5a6c09`:**

| Gate                                                                         | Result                 |
| ---------------------------------------------------------------------------- | ---------------------- |
| Package build                                                                | 54/54                  |
| Root tsc                                                                     | exit 0                 |
| q-api and web tsc                                                            | exit 0                 |
| eslint: q-core, model-gateway, q-specialists, q-api                          | 0                      |
| prettier                                                                     | clean                  |
| vitest, q-api + 7 packages                                                   | 7258 passed, 4 skipped |
| The 10 touched integration files                                             | 100/100                |
| New tests: binding (15, incl. firewall negatives), answer-level (3), v77 (3) | pass                   |

**Scripted Q-IQ, all 150, before/after step 3:** 571/573 → 571/573. The same two failures (MEM-134 #0, MEM-135 #0, the cross-conversation recall gap).

### Step 3c (removing the ORDINALS/PAIR/THIS/BACK/COUNTERPART regexes): held, not done

The rule was "remove only after scripted Q-IQ shows no regression". Scripted Q-IQ can't show that:

- The Q-IQ world composes no turn reader in FAKE mode (`q-iq-world.ts`: `turnReader` defaults to LIVE only).
- Its replies are the cases' reference text.
- So it never exercises reference binding, by regex or by model. A flat 571/573 there says nothing about binding quality.

Removing the regexes now would also delete lanes that answer before any reader, with zero model calls:

- ordinal recall ("what was the second one?");
- opening a record by place;
- page-control binding;
- explicit list places (A2).

Those would become reader-dependent and slower.

What unblocks it (integration owner or a session allowed live calls, per DECISIONS 60):

1. A live Q-IQ run on this branch with the reader (`--live`, about $4–5.5).
2. Compare pronouns, ordinals, follow-ups and ambiguity against BASELINE.md, with the regexes in and then out.
3. Remove them only if the out run is no worse.

This session's rules forbid live model calls.

Known limits:

- The hand-over subject ("book a meeting with him") still comes from the regex COUNTERPART binding.
- Model-bound people have no record id unless the ledger holds one.
- The existing `withMentions` and `withThreads` helpers (reader-registered names and open threads) aren't wired yet.
