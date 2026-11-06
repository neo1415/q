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
