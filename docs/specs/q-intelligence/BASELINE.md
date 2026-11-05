# Q-IQ baseline

Status: the benchmark exists (step 0, branch `feat/q-iq-benchmark`). The **live baseline has not been run yet**: reading the OpenAI key from Railway was refused by this session's permission policy (5 Nov 2026). Every score below is labelled with how it was produced. Nothing here is a live Q score yet.

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

**NOT RUN.** It is blocked on access to the provider key. When it runs, its table replaces this paragraph with these rows:

- one per category;
- overall;
- references resolved;
- wrong-entity turns;
- invented-figure turns;
- unknowns said as unknown;
- clarified;
- multi-part asks;
- helpfulness;
- latency;
- cost.

The runner prints the table in that shape.

## Cost

These are estimates. Nothing has been spent.

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

Every later step reports its delta against the live table above. That table does not exist until the live baseline has run.
