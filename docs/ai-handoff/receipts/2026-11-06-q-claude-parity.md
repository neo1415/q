# Q on Claude: cost first (DECISIONS 68), 6 Nov 2026

Branch `fix/q-claude-parity`, from `origin/fix/resume-asking-cv9ru3` at `d8e643f`. **No live call was made from this lane**, on either OpenAI or Anthropic. The one small paid Anthropic run is the integration owner's to run, with the command below. Running Anthropic test total: unchanged by this lane.

## Why cache reads were about 30% live

The live turns made 2–4 Claude calls each: tool rounds, then the answer. I reproduced that offline with `q-iq-claude-cache.integration.test.ts`:

- the real gateway, answer path, Anthropic SDK and adapter, over the wire double, whose cache model reads a prefix only where it was written byte for byte;
- 4 multi-turn conversations in one process;
- a scripted reader that reads each turn differently;
- a tool round before each answer.

On the base code this reproduced live: about 31% reads. Three causes, all in the adapter's prompt layout:

1. **Within-turn repeats.** Repeated prompts within a turn diluted the learned per-section change rate. Every call counted as a comparison, so per-turn sections looked stable, and the order flipped between the calls of one turn: the answer call missed the tool call's write.
2. **An unstable order.** A binary "volatile" cut-off at a 0.5 change share left the order unstable, and the stable-head breakpoint landed where no earlier request had written.
3. **Stable notes after the volatile tail.** Q's trusted notes that follow the prompt ("THEIR WORDS MAY BE MESSY", 7k characters; "TAKE THEM THERE", 3k) never change, but sat after the per-turn tail, so they could never be read from cache.

## What changed (`providers/anthropic-sections.ts`, `providers/anthropic.ts`)

All of this applies to the Anthropic request only. The OpenAI prompt and the rendered prompt content are untouched: nothing is added, removed or rewritten.

- **Repeats teach nothing.** A request identical to the person's previous one reuses that ordering and updates no statistics.
- **Order by change rate.** Sections are ordered by how often they change between one person's consecutive distinct requests, in tenths, least first, ties in place. The person's message changes every time, so it stays last. A long paragraph (2,000+ characters) inside a section is its own unit.
- **Stable-head breakpoint.** It sits after the leading units that change at most 10% of the time. That is the same position the previous turn wrote, so it is read.
- **Notes.** The late SYSTEM notes directly after the first user message are learned the same way. Those that hold still are said, still as marked `[Capital Q note]` blocks in the same user turn, right after the stable head and inside the cached prefix. Changing notes stay where they were.
- **Safety.** No note is lifted into `system`, so audit F-D3 still holds. A capitals line inside an untrusted fence is never a header, and fences are never split. Only hashes are kept, keyed by the gateway's hashed cache key.

## Before and after

Modelled offline at Sonnet's prices; live adds thinking and output tokens.

| Configuration                      | First call of a turn (read share) | Second call of a turn (read share) | First conversation | Each later conversation |
| ---------------------------------- | --------------------------------- | ---------------------------------- | ------------------ | ----------------------- |
| Live, before (fa5e455 and b166e46) | about 30%                         | —                                  | $0.30–0.49 a case  | —                       |
| Offline, base code                 | 0.31–0.47                         | 0.31–0.84                          | $0.264             | $0.213                  |
| Offline, this branch               | **0.90–0.91**                     | **0.98–0.99**                      | $0.149             | **$0.053 (4.0× lower)** |

The offline "this branch" rows hold from turn 2, and from turn 1 of every later conversation.

**Deterministic proof.** The test asserts, from the second conversation on, that every turn after the first reads at least 80% from cache. It also asserts that the cached prefix (tools, system and the first user message up to its first breakpoint) is byte-identical across all calls of a conversation.

## Quality (adapter differences from OpenAI): checked, nothing new changed

These are already handled on the base, from `fix/q-claude-reasoning-2`:

- **Structured output.** Constrained output is used only for small schemas and without tools; otherwise the schema goes by instruction, with the format restated last and lenient extraction of one JSON object from prose. The gateway's Zod validation is the same for both providers.
- **Tool-call shapes.** `tool_use` / `tool_result` are paired. A no-tools round's tool history is flattened to marked text.
- **Empty end_turn.** It is retried once at the model's default thinking.
- **max_tokens and stop reasons.** These are mapped: refusal → CONTENT_FILTERED, max_tokens → MAX_OUTPUT_TOKENS.
- **Reasoning.** Thinking is off for NONE, for tool continuations and for budgets under 4,096 tokens; otherwise adaptive at the mapped effort.
- **Prompts.** No prompt relies on an OpenAI-only shape.

**Remaining known differences.** These need live evidence rather than guesses:

- Claude runs at its default sampling temperature (any other value is refused).
- Constrained decoding is off for the large analyst schema.
- The no-narration line now sits in the closing reminder and is unverified live.

## Gates (this branch)

| Gate                                                                                                  | Result                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| build                                                                                                 | 0                                                                                                       |
| root tsc                                                                                              | 0                                                                                                       |
| q-api and workers tsc                                                                                 | 0                                                                                                       |
| eslint and prettier                                                                                   | clean                                                                                                   |
| vitest model-gateway + q-evals + config                                                               | 1,975 / 1,975                                                                                           |
| integration (scripted Q-IQ `CQ_Q_IQ_ALL=1`, claude-wire, claude-cache, gateway-postgres, answer-seam) | 18 / 18; scripted Q-IQ **573 turns, `fails: []`** (0 fails); claude-wire 84.6% of input read from cache |

## The paid run (integration owner): Q only, about 12 cases, hard stop

The runner (`q-iq-baseline.ts`) is now Anthropic-only, per DECISIONS 68:

- `--provider openai` is refused, and no OpenAI key is read or passed to the world.
- The helpfulness judge runs on `claude-haiku-5-5`, so its scores are not like-for-like with earlier judges on gpt-5.6-luna.
- `--q-only` skips the bare subject and gives Q the whole budget; `--no-judge` skips the judge.

```bash
CQ_Q_IQ_LOG=debug NODE_USE_ENV_PROXY=1 DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
ANTHROPIC_API_KEY_FILE=… \
node packages/q-evals/dist/dev/q-iq-baseline.js --live --provider anthropic --q-only \
  --limit 12 --budget 4 --out qiq-claude-parity.json 2> qiq-claude-parity-debug.log
```

`--limit 12` takes 12 cases round-robin across categories. Record its exact cost, and the running Anthropic total (about $10 before it), in this receipt.

## Raised bar: cost near OpenAI's; Claude-first staged

**Staged Claude-first routing: `20261231350000_ai_ops_claude_first_staged.sql`** (ordered after the base's `20261231340000`).

- **What it inserts.** Seven v3 policies, RETIRED: Claude (Sonnet for answers and analysis, Haiku for the fast classes) → gpt-5.6-luna → the v2 row's remaining fallbacks. Other columns are copied from v2.
- **Safety.** Inserts only; no status change to any existing row. v2 (OpenAI first, Claude the backup) stays ACTIVE.
- **The switch, data only:**
  - **Claude first:** `update ai_ops.routing_policies set status = 'ACTIVE' where version = 3 and code in ('normal_dialogue.v3', 'evidence_synthesis.v3', 'comparison.v3', 'deep_investigation.v3', 'fast_classification.v3', 'structured_extraction.v3', 'taxonomy_mapping.v3');`
  - **Back to v2:** the same statement with `'RETIRED'`.
- **pgTAP:** `999_ai_ops_claude_first_staged.test.sql` passes 8/8.
- **Q-IQ.** The runner now switches the v3 codes on locally and restores each row's prior status afterwards. The wire world activates v3 too, so offline numbers measure Claude-first.

**One-hour cache lifetime on the long-lived prefix.** The end-of-system and stable-head breakpoints use `ttl: "1h"`; the end-of-message and tool-loop breakpoints keep 5 minutes, and longer lifetimes come first, as the API requires. The wire double now refuses a 1h breakpoint after a 5m one.

- **Why.** People often pause longer than 5 minutes between turns; at the default lifetime each such turn re-wrote about 20k tokens.
- **Cost.** A 1-hour write bills 2× input instead of 1.25×, once per prefix. The modelled figures below price every write at 1.25×.

**Where the remaining cost is** (offline, a later 4-turn conversation, 8 Sonnet calls, $0.053 modelled):

| Component                        | Tokens            | Cost   | Share of cost |
| -------------------------------- | ----------------- | ------ | ------------- |
| Cache reads                      | 146,872           | $0.029 | 55%           |
| Cache writes (the per-turn tail) | 7,478             | $0.019 | 35%           |
| Uncached input and output        | 1,453 in, 240 out | —      | 10%           |

The first, cold conversation is $0.149: it writes the shared prefix, 47k tokens.

**The structural gap to OpenAI.** Sonnet's cache-read price ($0.20 per million tokens) is ten times gpt-5.6-luna's cached input price ($0.02). With caching now near its ceiling (90–99% reads), Q on Sonnet can match OpenAI's cost per case only by sending fewer tokens or using a cheaper model:

- **Trim the prompt.** About 19k tokens a call, the analyst prompt alone about 39k characters. That is a q-core prompt change, so it also changes OpenAI's prompt: the reader/prompt lane, one owner at a time.
- **Haiku 5.5 for answers.** Cache reads at $0.01 per million make it about 20× cheaper, a data-only change (the v3 rows' model). This is a quality decision for the owner, after a live Q-IQ comparison.
- **Fewer calls a turn.** Each tool round re-reads the whole prompt. The tool-round design is shared by every provider.

**Reader and answer cannot share a prefix.** Tools render first and the reader is offered none.

## The 7aa4bf6 paid run: quality first, then cost (offline diagnosis)

Owner's run on `7aa4bf6`: $1.556 for 12 cases ($0.130 a case); 71.1% of turns and 5 of 12 cases passed; 7 "wrong entity" turns. Receipt: `2026-11-06-q-claude-parity-live/`.

**Cause: the answer, not the reader.** In every "wrong entity" turn the reply is about the right subject. "The second one" was answered as Silo Health, "she" as Ngozi Eze, and "the other one" as Silo Credit. Each answer then added the subjects the turn forbids:

- QIQ-ORD-016 t1: "For comparison, Silo Credit reports $180k a month and Brightpath Logistics $150k."
- t2: "It sits below Silo Credit's $2.4M and above Silo Health's $1.1M."
- t4: "It's well below Silo Credit's 62%."
- PRO-001 t1 brought Tunde Bakare into "when did she join".
- AMB-136 t2 compared runway with Silo Health.
- UNK-076 t2 gave "the other companies here … between $750k and $5.2M".

The "invented" failures follow the same pattern: unasked working. FUP-031 said "would cover about 33 months" and "about 32 months", and COR-046 said "300000". The reader is therefore not the defect. Moving TURN_READ to Sonnet would cost more and fix none of these, so no routing migration is proposed. (The log had no reader output, so the binding was read from the replies. `CQ_Q_IQ_LOG=debug` now prints a `[q-iq reading]` line for each turn: kind, confidence, answerKind, question, reference, tool. Use it on the next run to confirm.)

I also checked whether `anthropic-sections` reorders the reader prompt and breaks its "above/below" references. It does not. The TURN_READER v81 sections that vary per turn (CONVERSATION STATE, RECENT TURNS, WHAT THEY JUST SAID) are already last, so their order is unchanged.

**Fix (adapter only, Claude only).** `ANSWER_SCOPE_GUIDANCE` is added to the closing reminder of every tool round, after every cache breakpoint: "Answer only what this message asks, about only whom it asks: do not bring in any other company or person, or their figures, and add no figures of your own working (implied cash, months of cover, differences, ranges), unless the message asks for a comparison or a calculation."

- It does not reach OpenAI or the reader, which has no tools.
- It narrows what is said, never what is true: unknown is still said to be unknown.
- **Unverified live.** Whether Sonnet holds it is what the next paid run shows.

**Cost: prose-only answers.** In 3 turns Sonnet answered in prose with no JSON. The gateway then asked again in TEXT and once more without tools. Each of those requests is a different prefix (no schema note, no tools), so each re-wrote 20-27k tokens of cache: $0.303 of the run's $1.733 at list prices. The adapter now handles this itself (`repairRequest`). It makes one more call on the same prefix, with the prose reply and a note asking for that answer as the JSON object. The wire double shows that call reading back everything the first call cached and writing nothing new. Both calls' tokens are counted (the empty-reply retry previously dropped the first call's usage).

| Modelled from the run's own log (list prices)   | $ per case |
| ----------------------------------------------- | ---------- |
| As run                                          | 0.144      |
| With the repair in place of the follow-on calls | **0.122**  |
| Q on OpenAI (owner)                             | ≈0.026     |

**Cache writes: where the ~450k came from.**

- Sonnet answers wrote 205k tokens over 52 calls. About 2.5k a call is the per-turn tail at its 5-minute breakpoint, which is needed for the tool rounds of that turn. The rest is each case's first call.
- The prose follow-ons wrote 143k. The repair removes these.
- Haiku's reader wrote 185k, but at $0.125/M that is $0.023 for the run.
- Nothing writes the same prefix twice. The 1-hour TTL on the head already lets turn 1's write serve every later turn.

What remains is structural. A Sonnet answer call costs about $0.017: about 27k read at $0.20/M, about 2.5k tail write, and about 570 output tokens. That is about 5 calls a case. The levers are the ones above (trim the prompt, fewer rounds, or Haiku answers), for the owner after the quality is fixed.

Two further tool-less final rounds (after a tool loop hit its budget) also re-wrote about 22k each, about $0.01 a case. Keeping the tools there with `tool_choice: none` would let them read the cache. Not done: flattening the tool history is what fixed the empty end_turns.

**Gates.**

- Adapter 31/31 and wire 7/7 (both new tests included).
- model-gateway, config and q-iq-budget: 1913 passed.
- Integration: q-iq-claude-wire 2/2, q-iq-claude-cache 1/1, answer-seam and gateway-postgres 10/10.
- Root `tsc`, plus `tsc` for q-api, workers and api.
- eslint and prettier on changed files.

## Anthropic test spend (DECISIONS 68 amended: $50 cap; slow down at $20, very careful past $40)

This lane has made **no** paid call. These are the live runs the integration owner reported to me, with the Anthropic part of each run's cost:

| Run (integration owner)        | Q on Claude | Bare Claude |
| ------------------------------ | ----------- | ----------- |
| `1ae3b64`, 11 cases            | $0.152      | $0.163      |
| `1ae3b64`, 1 case              | $0.011      | $0.025      |
| `dc0e244`, 1 case, debug       | $0.818      | —           |
| `1773825`, 1 case              | $0.490      | —           |
| `b166e46`, 1 case              | $0.301      | —           |
| `fa5e455`, 1 case              | $0.354      | —           |
| `7aa4bf6`, 12 cases            | $1.556      | —           |
| Subtotal reported to this lane | **$3.87**   | —           |

Add to that today's benchmark runs, about $4.40 as the owner reported. The total from what was reported is therefore at least about $8.3 (the owner's running figure after `7aa4bf6`: about $6 plus earlier adapter tests). The owner's estimate was about $10, which includes runs not reported here. **The Anthropic console's usage figure governs.** This lane has no admin key, and makes no call to check one.
