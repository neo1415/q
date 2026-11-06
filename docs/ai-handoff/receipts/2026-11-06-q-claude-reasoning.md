# Claude for reasoning: adapter, staged routing, Q-IQ runner (6 Nov 2026)

Branch `feat/q-claude-reasoning`, from `origin/fix/resume-asking-cv9ru3` at `0daf663`. This is DECISIONS 62: Claude for reasoning, OpenAI for voice and as the fallback.

Status: not merged, not deployed, migration not applied to the hosted database, and no live model call was made. The integration owner merges, runs CI and pgTAP, applies the migration, runs the live comparison and decides the switch.

## What was built

| Part          | Where                                                                                 | What it does                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter       | `packages/model-gateway/src/providers/anthropic.ts` (export `./providers/anthropic`)  | A `ModelProvider` over `@anthropic-ai/sdk` 1.4.0 (Messages API). Covers streaming text (`messages.stream`, text deltas only), tool calls, structured output, prompt-cache breakpoints, reasoning levels, usage, and failure classes. It runs only `claude-sonnet-5-5` and `claude-haiku-5-5` and refuses any other model before a request. SDK retries are off; the gateway owns retry. |
| Config        | `packages/config/src/model-providers.ts`                                              | `ANTHROPIC_API_KEY`: optional and opaque (`ProviderCredential`). An empty value means unconfigured. CI and e2e use `disabled-locally-000000000000`.                                                                                                                                                                                                                                     |
| Wiring        | `apps/q-api/src/main.ts`, `apps/workers/src/model-gateway.ts`, `apps/api/src/main.ts` | The adapter is registered when the key is set. A key alone routes nothing: routing is decided by the catalogue.                                                                                                                                                                                                                                                                         |
| Migration     | `supabase/migrations/20261231280000_ai_ops_anthropic_claude_reasoning.sql`            | Additive only: two columns, three new check constraints, and inserts. No DROP, no grant change, no RLS change, and no active route changes.                                                                                                                                                                                                                                             |
| Eligibility   | `policy/eligibility.ts`, `catalog.ts`, `infrastructure/postgres-catalog.ts`           | `owner_approved_ceiling`: a recorded owner approval can raise a no-training provider to CONFIDENTIAL and no higher.                                                                                                                                                                                                                                                                     |
| Answer budget | `packages/model-gateway/src/q/index.ts`                                               | The NORMAL_DIALOGUE per-call ceiling goes from 0.10 to 0.25 (reason under Deviations).                                                                                                                                                                                                                                                                                                  |
| Q-IQ runner   | `packages/q-evals/src/dev/q-iq-baseline.ts`, `runner/q-iq.ts`, `fixtures/world.ts`    | Adds `--provider anthropic` and a hard budget.                                                                                                                                                                                                                                                                                                                                          |

### The migration in detail

- **Provider `anthropic`** (`a1000000-…0004`). Recorded honestly:
  - `privacy_policy_class = NO_TRAINING_DEFAULT_RETENTION` and `supports_zero_retention = false`. Zero data retention is not contracted for this account, so the class alone justifies INTERNAL.
  - `owner_approved_ceiling = CONFIDENTIAL` with `owner_approval_ref = DECISIONS-62`. The metadata says CONFIDENTIAL eligibility is the owner's governance decision 62, not a zero-retention or enterprise-contract claim.
  - Checks on the table:
    - the ceiling is INTERNAL or CONFIDENTIAL;
    - a ceiling requires a decision reference;
    - an approval is allowed only on a no-training class (an UNREVIEWED or TRAINING_PERMITTED provider cannot be approved upward).
- **Models:**

  | Model               | Id        | Used for                                          | Ceiling      | Quality / latency | Notes |
  | ------------------- | --------- | ------------------------------------------------- | ------------ | ----------------- | ----- |
  | `claude-sonnet-5-5` | `a2…0030` | answers, synthesis, comparison, investigation     | CONFIDENTIAL | HIGH / STANDARD   |       |
  | `claude-haiku-5-5`  | `a2…0031` | turn reader, classification, extraction, taxonomy | CONFIDENTIAL | STANDARD / FAST   |       |

  Both: 1M context window, 128k output, tools, structured output, prompt cache and reasoning.

- **Prices** (`model_prices`, USD per million tokens):

  | Model      | Input | Cache read | Output | Batch       |
  | ---------- | ----- | ---------- | ------ | ----------- |
  | Sonnet 5.5 | 2.00  | 0.20       | 10.00  | 1 / 5       |
  | Haiku 5.5  | 0.10  | 0.01       | 0.50   | 0.05 / 0.25 |

  Haiku's 0.10 / 0.50 is the rate card for prompts of 100k tokens or fewer. Longer prompts bill at 0.50 / 2.50; the model's metadata records this.

- **Routing:** seven staged v2 policies, inserted with status `RETIRED`.
  - Classes: `normal_dialogue`, `evidence_synthesis`, `comparison`, `deep_investigation`, `fast_classification`, `structured_extraction`, `taxonomy_mapping`.
  - Order: Claude → OpenAI `gpt-5.6-luna` → Groq `openai/gpt-oss-120b` → the v1 row's Gemini fallbacks. Gemini is PUBLIC-only, so it never receives a CONFIDENTIAL request.
  - Every other column is copied from v1: reasoning levels, hedge, sensitivity, quality floor and latency. The one exception is the `normal_dialogue.v2` cost ceiling, which is 0.25.
  - Untouched: UI_TRANSLATION, voice and realtime, image and embedding routes.

## Switching routing on and off

The gateway takes the **highest ACTIVE version** per task class. Turning v2 on therefore wins over v1, and v1 stays in place for the rollback. The catalogue cache TTL is 60 s, so the change takes effect within a minute without a deploy. The code must already be deployed, because a service without the adapter skips Claude as unconfigured and falls to OpenAI.

**Switch on** (one statement):

```sql
update ai_ops.routing_policies set status = 'ACTIVE'
 where code in ('normal_dialogue.v2', 'evidence_synthesis.v2', 'comparison.v2',
                'deep_investigation.v2', 'fast_classification.v2',
                'structured_extraction.v2', 'taxonomy_mapping.v2');
```

**Switch off / roll back** (one statement):

```sql
update ai_ops.routing_policies set status = 'RETIRED'
 where code in ('normal_dialogue.v2', 'evidence_synthesis.v2', 'comparison.v2',
                'deep_investigation.v2', 'fast_classification.v2',
                'structured_extraction.v2', 'taxonomy_mapping.v2');
```

**Emergency, Claude only:**

```sql
update ai_ops.providers set status = 'DISABLED' where code = 'anthropic';
```

This skips Claude but keeps the v2 order, so OpenAI is first and Groq second. Undo it with `status = 'ACTIVE'`.

**Check:**

```sql
select code, status from ai_ops.routing_policies where version = 2 order by code;
```

The switch is a data change on `ai_ops`, not a migration. `hosted-migrate-https.mjs` applies migrations only. Run the statement through the operator's usual hosted SQL route and record it in HANDOFF-LOG.

## Order of operations for the integration owner

1. Merge, then run CI (quality and pgTAP).
2. Apply `20261231280000` with `node scripts/handoff/hosted-migrate-https.mjs --apply 20261231280000`. It is additive, with no DROP and no RLS change. Applying it changes nothing that serves traffic: the v2 rows are RETIRED. Code deployed before this migration still loads the catalogue: the new provider row parses, `owner_approved_ceiling` is read through `to_jsonb`, and old code ignores it.
3. Deploy (q-api, workers, api). `ANTHROPIC_API_KEY` is already set on q-api and workers (DECISIONS 62). api registers the adapter only if the key is set there too; without it, GateQ calls stay on OpenAI.
4. Run the live comparison: Q-IQ, as below.
5. If parity holds, run the switch-on statement. Watch `ai_ops.model_usage` (`provider_id = a1000000-…0004`) and the gateway's provider-health logs.

## Q-IQ on Claude (live comparison, not run here)

```bash
NODE_USE_ENV_PROXY=1 DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
OPENAI_API_KEY_FILE=… ANTHROPIC_API_KEY_FILE=… \
node packages/q-evals/dist/dev/q-iq-baseline.js --live --provider anthropic \
  --budget 4.5 --limit 150 --out qiq-claude.json
```

- **The switch, locally:** the runner switches the v2 policies on in the **local** database only (it refuses a non-loopback `DATABASE_URL`) and switches them off in a `finally`.
- **Claude only:** Claude is the only adapter registered, so the Q subject measures Claude and never a fallback. A Claude failure shows as a failed case, not as an OpenAI answer.
- **Bare subject:** `claude-sonnet-5-5` at reasoning NONE.
- **Judge:** stays on `gpt-5.6-luna` for both providers, so the OpenAI and Claude runs share one judge. `OPENAI_API_KEY_FILE` is therefore required.
- **Budget:** hard. A case starts only if the dearest case so far still fits. Claude is budgeted at 1.25× input, the cache-write rate and the most any input token can cost, because the ledger prices cache writes at the base rate. A `--budget` above $20 is refused (the owner's test cap). For a like-for-like comparison, run the same command with `--provider openai`.

## Prompt compatibility (item 5)

- **No OpenAI-only request shapes in prompts.** A search of `q-core/src/prompts`, `q-specialists/src` and `model-gateway/src` found no `response_format`, JSON mode, `developer` role or `tool_choice` in any prompt or caller. All of these are adapter concerns, and the adapter handles them:
  - **System role:** only the leading SYSTEM messages become `system`. A later SYSTEM message (for example fetched web text) becomes a marked `[Capital Q note]` in a user turn, exactly as the OpenAI and Google adapters do it (audit F-D3).
  - **Assistant-first or assistant-last histories:** OpenAI accepts both. On Claude, the first is a 400 and the second is a prefill 400. The adapter bridges both with a marked note, and a test covers it.
  - **`temperature`:** never sent. Sonnet 5.5 and Haiku 5.5 reject non-default sampling with a 400.
  - **`tool_choice`:** never sent. Forced choice is a 400 on Sonnet 5.5. No caller forces a tool.
- **Structured output.** Constrained decoding on Claude has published limits: at most 24 optional properties and 16 union-typed properties per request; every object closed; no records, recursion or `$ref`; no numeric, length or pattern bounds.
  - The adapter sends constrained `output_config.format` when a schema fits. Unsupported bounds are dropped from what is sent and are still enforced by the gateway's Zod validation.
  - When a schema does not fit, the adapter states it in the system instructions. The gateway's validation and correction pass then apply as for every provider.
  - Survey of the active registry (scratch script, every ACTIVE structured task): **73 constrained, 3 by instruction**:
    - `TURN_READER`: 81 optional fields.
    - `COMPANY_ANALYST`, the main answer: union and record fields.
    - `APP_ACTION_ARGUMENTS`.
  - These three are the main risk to check in the live comparison: invalid-JSON or corrected-retry rates in `ai_ops.model_usage` (`INVALID_MODEL_OUTPUT`).
- **Prompt caching, not fixable in the adapter.**
  - The adapter places breakpoints at the end of the leading system blocks. Since tools render first, this covers tools plus the charter. Inside a tool loop it also places one at the end of the conversation so far.
  - OpenAI caches any shared prefix automatically. Anthropic caches only up to a breakpoint at a block boundary.
  - The turn reader's ~13.5k-token stable prefix is mostly the TURN_READER task text, which `renderPrompt` puts in the **same USER message** as the per-turn variables. On Claude only the charter part is cached.
  - To cache the rest, the renderer should emit the task's static head as its own leading block, for example a second SYSTEM message before the variables. That is a q-core change and a reader lane (P3 items 3–5, one owner). **Not done here; reported.**
- **Reasoning.** The task asked for budgets, but these models take none: `budget_tokens` is a 400 on Sonnet 5.5 and Haiku 5.5. The levels map to adaptive thinking plus `output_config.effort`:

  | Level  | Thinking                                                    | Effort |
  | ------ | ----------------------------------------------------------- | ------ |
  | NONE   | off: `between_tools` on Sonnet 5.5, `disabled` on Haiku 5.5 | low    |
  | LOW    | adaptive                                                    | low    |
  | MEDIUM | adaptive                                                    | medium |
  | HIGH   | adaptive                                                    | high   |
  - Thinking text is never displayed or read.
  - A **tool-call continuation** runs with thinking off at the requested effort. Capital Q's message contract carries no thinking blocks, and replaying an assistant tool-call turn without its thinking is a turn the API may refuse with thinking on. The first call of a turn, where the deciding happens, keeps thinking.

## Deviations and known limitations

- **Owner-approval column.** With an honest NO_TRAINING_DEFAULT_RETENTION class, `providerJustifiedCeiling` capped Anthropic at INTERNAL. Decision 62's CONFIDENTIAL approval had no lawful place to live, short of falsely claiming zero retention. The new column records the approval with its decision reference; DB checks and unit tests bound it. **This is the one change to eligibility semantics; review it.**
- **NORMAL_DIALOGUE budget 0.10 → 0.25.** The gateway estimates an attempt at full input price plus the whole output budget. At Sonnet's prices, a 30k-token answer prompt with 4,096 output tokens estimates at about $0.10, so long answers would have silently gone to OpenAI. The new ceiling changes nothing for gpt-5.6-luna. Other per-call budgets (small talk 0.01, reader 0.01, extraction) were checked: Haiku fits all of them, and Sonnet fits small talk only for short prompts. A turn that does not fit falls back to OpenAI, which is correct behaviour but means Claude does not serve that turn.
- **Cache writes are under-priced in the ledger.** Anthropic bills cache writes at 1.25× input; `model_prices` has one input rate, so writes are recorded at 1×. Ledger cost therefore understates real spend by at most 25% of written tokens. The Q-IQ runner budgets around this.
- **No server-side refusal fallback** (Anthropic's `fallbacks` parameter). A `refusal` stop maps to `CONTENT_FILTERED`, and fallback is the gateway's job, to OpenAI.
- **Latency class.** Sonnet is recorded as STANDARD, which is unmeasured; no caller sets a latency target today.
- **api service.** The adapter is wired, but DECISIONS 62 names q-api and workers for the key.

## Gates (exact results, this branch)

| Gate                                                                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec turbo run build --filter=./packages/*`                                                                                                            | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Root tsc (`node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`)                                                        | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| tsc for apps/q-api, apps/workers and apps/api                                                                                                                | exit 0, exit 0, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                     |
| eslint (`NODE_OPTIONS=--max-old-space-size=6144`) on every touched file, including `apps/q-api/src/main.ts` and `apps/api/src/main.ts`                       | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| prettier `--check` on touched files                                                                                                                          | clean                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| vitest `packages/model-gateway` + `packages/config` (final code)                                                                                             | 197 files, **1,803 / 1,803 pass**. An earlier run caught `boundaries.test.ts` (an SDK import in the new test); fixed by re-exporting the error classes from the adapter.                                                                                                                                                                                                                                                                   |
| vitest `packages/q-evals`                                                                                                                                    | 8 files, 67 / 67 pass                                                                                                                                                                                                                                                                                                                                                                                                                      |
| vitest `apps/q-api`                                                                                                                                          | 335 files (1 skipped), 3,123 pass, 3 skipped, 0 fail                                                                                                                                                                                                                                                                                                                                                                                       |
| Integration on local PG, `gateway-postgres.integration.test.ts` (`DATABASE_URL` and `CQ_TEST_DATABASE_URL` = `postgresql://postgres@127.0.0.1:54329/cq`)     | 4/4. The new case loads the real migrated rows, applies the switch and proves:<ul><li>CONFIDENTIAL dialogue goes to `claude-sonnet-5-5` and the reader's class to `claude-haiku-5-5`;</li><li>an exhausted Anthropic account falls to OpenAI;</li><li>both exhausted falls to Groq (attempts `anthropic, openai, groq`);</li><li>all three exhausted is a `ModelGatewayError`, and the PUBLIC-only Gemini fake gets **0 calls**.</li></ul> |
| pgTAP `999_ai_ops_anthropic_claude_reasoning.test.sql`                                                                                                       | 24/24                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| pgTAP `320_ai_ops` (updated counts, owner-approval invariant), `999_ai_ops_routing_reasoning_levels`, `130_schema_guard` (no new table), `897`, `730`, `882` | 35/35, 12/12, 12/12, all pass                                                                                                                                                                                                                                                                                                                                                                                                              |
| Full local pgTAP (193 files under `rls/` plus 4 top-level files)                                                                                             | 191/193 `rls/` files pass; the 4 top-level files pass. The 2 failures, `280_document_processing` and `420_recommendation_slates`, call `pgmq.list_queues()`, which the local pgmq stub (`scripts/local-pg/pgmq--1.0.sql`) does not define. They touch no `ai_ops` object. CI's Supabase stack is the gate of record.                                                                                                                       |
| Scripted Q-IQ `CQ_Q_IQ_ALL=1` (`q-iq.integration.test.ts`, keys `disabled-locally-…`)                                                                        | 3/3 tests. 150 core cases, **573 turns, `fails: []`, score 1**; ADVERSARIAL score 1, `fails: []`; live 2026-11-06 gaps pass. No regression.                                                                                                                                                                                                                                                                                                |
| New unit tests                                                                                                                                               | `anthropic-adapter.test.ts` 17, `owner-approved-ceiling.test.ts` 3, `q-iq-budget.test.ts` 3: all pass                                                                                                                                                                                                                                                                                                                                      |

No live model call was made. No deploy, no hosted migration, no force-push.

## Follow-up: "(no reply)" on Claude (branch `fix/q-claude-reasoning-2`)

**The live symptom.** The integration owner ran `--provider anthropic` on `1ae3b6453`.

| Subject     | Result                                                      |
| ----------- | ----------------------------------------------------------- |
| Bare Sonnet | 90.5%                                                       |
| Q           | Every turn was "(no reply)". No exception and no error log. |

The 1-case rerun (QIQ-PRO-001) had 121,127 input tokens for $0.0114. That is Haiku's price: the turn reader ran and **the Sonnet answer call never billed**.

**What the seam showed.** `q-iq-claude-wire.integration.test.ts` runs the scripted Q-IQ world through the real gateway, answer path, Anthropic SDK and adapter. Only the HTTP transport is replaced, by `anthropic-wire-double.ts`. The double speaks the Messages API's JSON and SSE shapes and refuses what the API documents it refuses.

- **Streaming is fine.** With the API accepting, every streamed Claude answer is published (the first test). So the streaming path, text extraction and publication are not the fault.
- **A failed answer call is silent.** When Sonnet's answer call is refused, Q publishes nothing on every turn and logs nothing. That is exactly the live symptom, and it matches the cost profile, because a 400 is unbilled.
- **The answer request's shape.** Every Q answer request is: Sonnet, streaming, `thinking: between_tools`, effort `low`, 4 tools, and a constrained `output_config.format` of the 7.8 KB answer schema. The bare model, which works live, sends none of the format or tools.

**The fix.**

- **Plain-shape retry.** A 400 for a shape the adapter chose is sent once more in the plain shape. "A shape the adapter chose" means a constrained format, or an explicit thinking-off mode outside a tool continuation. The plain shape states the schema in the instructions and leaves thinking at the model default, with the same effort.
- **Remembered.** The model/schema pair is remembered, so later calls go straight to the plain shape. 400s arrive before any output and are unbilled.
- **Proof.** The second seam test refuses every constrained Sonnet format. It fails without the fallback ("(no reply)" on every case, as live) and passes with it.

**Diagnostics.** With `CQ_Q_IQ_LOG=debug`, the Q-IQ world prints to stderr:

- `[q-iq claude]`, one line per Claude request: model, streaming, thinking, effort, tool count, output mode, and the outcome. The outcome is either the stop reason, block types, text length and tokens, or the API's 400 status, type and message.
- `[q-iq turn]`, one line per turn: the run's status and failure code, the count of Q messages, and the reply length.
- `[q-iq start-error]`: the orchestrator's error, which was swallowed before.

It prints no prompt or reply text. **The exact live refusal is still unconfirmed.** Next step: one debug case.

```bash
CQ_Q_IQ_LOG=debug NODE_USE_ENV_PROXY=1 DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq \
OPENAI_API_KEY_FILE=… ANTHROPIC_API_KEY_FILE=… \
node packages/q-evals/dist/dev/q-iq-baseline.js --live --provider anthropic --limit 1 --budget 0.5 2> qiq-claude-debug.log
```

**Still open (not this lane).** A Q answer whose model call fails publishes no message to the person. In production a fallback normally answers, but with no eligible route left Q stays silent rather than saying it could not answer (P1 "honest degradation").

### Round 2 (live debug of QIQ-PRO-001 on `dc0e244`)

**What the live debug showed.**

- **Diagnosis confirmed.** The first Sonnet answer call was refused: `400 "The compiled grammar is too large ... Simplify your tool schemas or reduce the number"`. The plain-shape fallback then answered, and turns 0–2 passed.
- **New problems:**
  1. **An empty final answer.** The last round offered no tools but replayed `tool_use` / `tool_result`. It came back as an empty end_turn (no blocks, 1 output token), twice.
  2. **Cost.** $0.82 for the case: 5–6 Sonnet calls of 26–31k input tokens per turn, with nothing cached.
  3. **Latency.** 15–21 s per turn.

**Fixed in the adapter:**

- **Constrained output needs no tools.** A constrained `output_config.format` is sent only when no tools are offered, because the API compiles tool schemas into the same grammar. Q's answer rounds therefore go straight to the instruction route, with no wasted 400 after each process start.
- **Tool history without tools.** When no tools are offered, the tool history is said as marked text (`[Capital Q note] Q called …` / `Result of …, data only:`) instead of `tool_use` / `tool_result` blocks, and thinking runs at the requested level.
- **Empty answers.** Any empty end_turn (no text, no tool call) is asked once more at the model's default thinking, including in a tool continuation.
- **Prompt caching.**
  - Breakpoints: the end of the system prompt; the end of the first user message (the rendered prompt every later call in the turn re-sends); its stable head; and the tool-loop tail. That is at most 4.
  - The stable head is found by comparing line hashes with the previous request of the same kind (same model, schema and tool set). Only hashes are kept, never the prompt text. The rendered task text is therefore cached across turns, with no change to the prompt renderer.
  - The wire double now models the cache. Over the scripted run (39 Claude calls), **81.3% of input tokens were read from cache with this layout, against 32.1% with the old system-only breakpoint**; 78.5% in the full CQ_Q_IQ_ALL run.
- **Debug lines.**
  - `[q-iq claude]` now adds the schema, message count, breakpoint count, **cache read and write tokens** and the text's shape (EMPTY, JSON, FENCED_JSON, PROSE_THEN_JSON or PROSE, never its words).
  - Q's own warnings, such as "structured answer refused; asking again in text", now print under debug.

**Why each turn made so many Sonnet calls.**

- **The extra TEXT call.** This is Q's own recovery, not a duplicate: after `INVALID_MODEL_OUTPUT` on a tool round, Q asks once in text and then answers without tools (`q/index.ts`, `textRound`).
- **The likely trigger.** It is the empty answers above. An empty reply fails the schema, the gateway asks again (a correction pass), Q's text round runs, and then the no-tools final runs. Each step is a full ~28k-token Sonnet call. With the empty-answer retry and the flattened final round, that chain should collapse. The next debug run will show it.
- **The downgrade is remembered** per adapter instance (model + schema), so the constrained 400 happened once per process, not every turn. With tools it is no longer attempted at all.
- **The aborted Haiku reader call** is the reader's same-model hedge, by design (`TURN_READER_SAME_MODEL_HEDGE_MS` = 3,500 ms). It fires when the uncached ~17k-token reader takes longer than that. The new head caching should make it rarer. The hedged call is billed for input up to the abort.

**Gates on `73faf46` plus the eslint fix:**

| Gate                                                                       | Result                          |
| -------------------------------------------------------------------------- | ------------------------------- |
| build                                                                      | 0                               |
| root tsc                                                                   | 0                               |
| q-api and workers tsc                                                      | 0                               |
| eslint and prettier                                                        | clean                           |
| vitest model-gateway + q-evals + config                                    | 1,894 / 1,894                   |
| integration (scripted Q-IQ `CQ_Q_IQ_ALL=1`, claude-wire, gateway-postgres) | 10 / 10; 573 turns, `fails: []` |

### Round 3 (live re-run on `1773825`: 4/4 answered, $0.49 a case, 12.6–21.8 s a turn)

**Fixed in the adapter:**

- **Reader thinking.** Thinking shares the output budget. Below 4,096 output tokens, thinking is off: the turn reader runs at 1,200. Live, Haiku's adaptive thinking ended four reader calls at `max_tokens` with the JSON unfinished, and each was asked again. The plain and empty-retry shapes keep it off too.
- **Grammar size.** Constrained decoding also needs a small grammar: a sanitised schema of at most 4,096 characters. Live, the company analyst's answer schema alone, with no tools, was refused as "compiled grammar is too large". Larger schemas go by instruction from the start, with no refused request first.
- **The format as the last word.** By instruction, the format is now restated at the end of the final user turn ("Reply with only the X JSON object: start with { and end with }"), after every cache breakpoint, so the cached prefix is untouched.
- **Prose around the JSON.** When prose surrounds one JSON object that parses, the object is the answer. The gateway still validates it against the caller's schema. This was the turn-0 trigger: PROSE_THEN_JSON was refused, which caused the text round.

**Cost.** Unmeasured offline beyond the cache model, which reads 81.1% of input from cache on the scripted run. What is left after these fixes:

- **Cache writes:** each turn's first Sonnet call writes its prompt at 1.25× input.
- **Output tokens:** $10 per million on Sonnet, thinking included. The next debug run shows output tokens per call.

**Gates:**

| Gate                                    | Result                          |
| --------------------------------------- | ------------------------------- |
| build                                   | 0                               |
| root tsc                                | 0                               |
| q-api and workers tsc                   | 0                               |
| eslint and prettier                     | clean                           |
| vitest model-gateway + q-evals + config | 1,898 / 1,898                   |
| integration                             | 10 / 10; 573 turns, `fails: []` |
