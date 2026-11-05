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
