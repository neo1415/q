# Q-IQ baseline

Status: the benchmark exists, and the **first live baseline ran on 5 Nov 2026** (11:02–12:20 UTC, integration owner session, total cost **$3.48**). The Q score is for Q at merged head `9f138f135`, which contains steps 0, 1 and 6 but not the later claim-check fix `fdcf86871`. It is **not** a pre-change score.

## What Q-IQ is

- **Cases.** 150 multi-turn conversations of 3–8 turns, 15 in each of the plan's 10 categories: 573 graded turns in all. The source is `packages/q-evals/src/datasets/q-iq/`.
- **World.** Every company, person, deck and investor is invented. Names come in confusable pairs (Silo Credit / Silo Health, Ledgerfold / Ledgerline, Brightwell / Brightpath).
  - Some fields are deliberately absent, for the UNKNOWN category.
  - Five metrics carry two conflicting sources, for CONTRADICTIONS.
- **Expectations.** Each turn records:
  - the expected entity ids, and the confusable ("forbidden") ones;
  - the figures the reply must state, plus any derived figures it may state;
  - required terms;
  - the expected behaviour: ANSWER, UNKNOWN or CLARIFY.
- **Graders.** All graders are deterministic code over the reply text (`packages/q-evals/src/graders/q-iq.ts`). Figures are compared by value: $2.4M, 2,400,000 and 2.4 million are the same figure.
  - **Invented figure:** any figure not in the authorised facts, not in the person's own words, and not a derivation the case allows.
  - **Wrong entity:** a figure that belongs only to the confusable entity, or naming the confusable entity without naming the expected one.
  - **Unknown:** the reply says it doesn't know, invents no figure, and doesn't turn missing into zero.
  - **Clarify:** one question of 60 words or fewer that names both readings and gives no figure for just one of them.
  - **Helpfulness:** a separate 1–5 rubric judged by a model. It is live-only and never folded into the score.
- **Subjects.**
  - **Q** (`runner/q-iq-world.ts`): every turn is a real run on a local database, in one stored conversation per case. A run passes through:
    - createRun;
    - the LangGraph orchestrator;
    - the Context Firewall;
    - the Safe Read tools;
    - the outer answer layer, with the turn reader and reference rules, composed as in q-api;
    - the conversational answer layer;
    - the Model Gateway.
  - **Bare model** (`runner/q-iq.ts`): the same provider and model, at reasoning NONE. It gets a two-line neutral system message, the same authorised fact statements, earlier conversations as stored turns, and the raw conversation. It has no Q layers.
- **Not composed into the Q subject.** Production has these, but the eval world does not:
  - memory recall across conversations;
  - document retrieval;
  - the company specialist's own investigation.

  So Q's CROSS_CONVERSATION_MEMORY score here measures "no recall wired". Step 9 owns closing that gap.

## How to run

```bash
# CI / scripted (free): unit tests, plus the scripted table
pnpm exec vitest run packages/q-evals/test/q-iq.test.ts
node packages/q-evals/dist/dev/q-iq-baseline.js

# Q runtime with the scripted model (needs a local DB: scripts/local-pg/setup.sh)
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq CQ_TEST_DATABASE_URL=$DATABASE_URL \
  pnpm exec vitest run --config vitest.integration.config.ts packages/q-evals/test/q-iq.integration.test.ts

# LIVE (founder credit; on request only). The key is read from a file and never printed.
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq NODE_USE_ENV_PROXY=1 \
OPENAI_API_KEY_FILE=/path/to/key node packages/q-evals/dist/dev/q-iq-baseline.js \
  --live --budget 4.5 --out q-iq-live.json
```

## Scores

### Scripted (reference replies, CI mode)

This checks the graders, not intelligence. With the reference replies, every category scores 100%: 150/150 cases and 573/573 turns. That also holds through the real Q runtime with the scripted model (the integration test runs one case per category; a full 150-case run gave 573/573 turns and 0 errors).

### Live baseline — Q vs the bare model (gpt-5.6-luna, reasoning NONE)

**Q @ 9f138f135 (steps 0+1+6, before the claim-check fix forward)** vs the **bare model** (same provider, raw conversation plus the same facts, no Q layers). Run 5 Nov 2026, `--budget 4.5`.

| Category                                | Q                                                                                           | Bare model                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------- |
| PRONOUNS_PEOPLE                         | 86.7%                                                                                       | 100.0%                     |
| ORDINALS_LISTS                          | 83.1%                                                                                       | 98.5%                      |
| FOLLOW_UPS                              | 82.7%                                                                                       | 94.7%                      |
| CORRECTIONS                             | 86.7%                                                                                       | 100.0%                     |
| COMPOUND                                | 75.6%                                                                                       | 80.0%                      |
| UNKNOWN                                 | 75.0%                                                                                       | 80.0%                      |
| CONTRADICTIONS                          | 95.6%                                                                                       | 100.0%                     |
| NUMBERS                                 | 64.4%                                                                                       | 95.9%                      |
| CROSS_CONVERSATION_MEMORY               | 44.4% (6 of 15 cases, 8/18 turns)                                                           | 100.0%                     |
| AMBIGUITY                               | not run (0 of 15 cases)                                                                     | 64.4%                      |
| **Overall (turns)**                     | **79.2%**                                                                                   | **92.1%**                  |
| Overall, same 126 cases (like-for-like) | 79.2% (397/501)                                                                             | 94.2% (472/501)            |
| Cases fully passed                      | 56/126                                                                                      | 109/150                    |
| References resolved                     | 92.2%                                                                                       | 98.6%                      |
| Wrong-entity turns                      | 7                                                                                           | 1                          |
| Turns with an invented figure           | 6                                                                                           | 14                         |
| Unknowns said as unknown                | 46.3%                                                                                       | 63.4%                      |
| Ambiguous asks clarified                | not run                                                                                     | 0.0% (0/15; it never asks) |
| Multi-part asks fully answered          | 81.3%                                                                                       | 86.7%                      |
| Helpfulness (rubric, 1–5)               | 4.67                                                                                        | 5.00                       |
| Reply latency p50 / p95 (whole reply)   | 6.9 s / 11.9 s                                                                              | 1.1 s / 1.8 s              |
| Cost                                    | $3.390                                                                                      | $0.086                     |
| Cases run                               | 126/150 (budget stop; cases ran in category order, so no AMBIGUITY and only 6 memory cases) | 150/150                    |

Reading it:

- Like-for-like, over the 126 cases Q ran, Q's layers **lose** to the bare model by **15.0 points** (79.2% vs 94.2%). Q loses in every category it ran.
- The biggest losses:
  - **numbers**, −31.5 points. This is likely the step-6 claim check before its fix forward (timestamp and minute false positives); it needs a re-run on `fdcf86871`.
  - **cross-conversation memory**, −55.6 points over only 6 cases. Part of that is the harness: the eval world wires no memory recall for Q, while the bare model gets the earlier transcripts. Step 9 owns that.
  - **pronouns, ordinals, follow-ups and corrections**, −12 to −15 points. Steps 2 and 3 own those.
- **Ambiguity is unmeasured for Q.** The bare model never asks a clarifying question (0/15).
- Q invented a figure in fewer turns (6 vs 14), but over fewer cases. Neither meets the bar of 0.
- Q is about 6× slower and 40× more expensive per conversation in this harness. Step 11 owns that.
- The goal bar (Q ≥ bare in every category) is met in **no** category Q ran.
- A reporter bug scored the empty category as 100%; it is fixed in `43542e006`. Next run:
  - cases go round-robin across categories, so a budget stop samples all 10;
  - pass `--out` to keep per-turn JSON.

## Cost

Actual, first live run: **$3.476** ($3.390 Q, $0.086 bare model and judge). The estimate below undercounted Q: Q's actual cost per case was about 2.5× the estimate.

| Item              | Basis                                                                                                                                                                                            | Estimate        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Q answer calls    | measured: 8.55M input tokens across the 573 turns, from the full scripted run through the runtime (14.9k per turn); plus about 30% for tool rounds; $0.20/M input ($0.02 cached), $1.20/M output | $1.6 – $2.9     |
| Q turn reader     | 573 calls of about 4k tokens                                                                                                                                                                     | $0.2 – $0.5     |
| Bare model        | 573 calls of about 4.5k tokens, growing over each conversation                                                                                                                                   | $0.4 – $0.7     |
| Helpfulness judge | 300 transcripts of about 2.5k tokens                                                                                                                                                             | about $0.15     |
| **Total**         |                                                                                                                                                                                                  | **$2.4 – $4.2** |

The runner enforces a hard cap of `--budget 4.5`:

- Q may spend up to 75% of the budget.
- The bare model and the judge get the rest.
- A subject that reaches its share stops, and the result reports the cases it actually ran.

## Deltas

Every later step reports its delta against the live table above. The next run should be on `fdcf86871` or later, with a budget of about $5 for Q, so all 150 cases complete.
