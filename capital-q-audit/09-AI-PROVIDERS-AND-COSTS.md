# 09 — AI Providers and Costs

Investigator F · 2026-10-08 · branch `recovery/2026-09-12-8y2j4w` @ `520bd123` · read-only.
Evidence excerpts: `capital-q-audit/evidence/providers/*.md`. Env var NAMES only; no values were read.

Status legend: IMPLEMENTED / PARTIAL / CONFIGURED-UNUSED / MOCKED / BROKEN / UNTESTED / PLANNED.

---

## 1. Summary

- **Text LLM calls go through one path.** Every text LLM call reaches a provider through `createModelGateway(...).execute` (`packages/model-gateway/src/gateway.ts:590`). The only files that import the provider SDKs (`openai`, `@google/genai`, `groq-sdk`) are the three adapters in `packages/model-gateway/src/providers/*.ts`. I found no feature code that calls an LLM SDK directly (grep in §6).
- **Four AI paths do not use the routing policies:**
  - realtime voice (`packages/model-gateway/src/realtime/openai.ts`)
  - image generation (`packages/model-gateway/src/images/*`)
  - OpenAI embeddings (`packages/q-embeddings/src/infrastructure/openai-provider.ts`)
  - the voice vendors Deepgram, ElevenLabs and Recall.ai (`apps/q-api/src/voice/providers/*`, `apps/q-api/src/composition/recall-bots.ts`)

  These paths hard-code model ids in code. Only images and realtime write to `ai_ops.model_usage`.

- **Routing is data in `ai_ops.routing_policies`.** It is not code. The net result of the migrations is `gpt-5.6-luna` first for six of the seven task classes, and `gemini-3.5-flash-lite` first for `FAST_CLASSIFICATION`, with a hedge to luna after 2000 ms.
- **OpenAI is now the primary paid provider, but config and IaC still call it "diagnostic only":**
  - The adapter's header comment and `packages/config/src/model-providers.ts:116-124` still say "diagnostic only".
  - `.railway/railway.ts:101-106` does not list `OPENAI_API_KEY` at all.
  - The adapter refuses every model except `gpt-5.6-luna` (`providers/openai.ts:61-62, 364-375`).
- **Google (Gemini) is UNREVIEWED, so its ceiling is PUBLIC.** It can serve the turn reader for real conversation turns only when the deployment holds the SYNTHETIC_DEMO attestation (`policy/eligibility.ts:295-309`). The lead's live trace shows the turn reader served by `gemini-3.5-flash-lite`. So either the hosted deployment holds that attestation, or the turn was PUBLIC (open question, §9).
- **Confirmed defect (catalog id collision):** `a2000000-…-000000000022` is inserted as `gpt-realtime-mini` (20261203090000) and again as `gemini-3.1-flash-lite-image` (20261215090000), both with `on conflict do nothing`. The image row never exists. Every Google image usage row is attributed to the realtime model id (§7.1).
- **Spend caps.** There is no aggregate daily cap for text inference, only per-request `maxEstimatedCostUsd`. The duplex voice daily cap (default $1/UTC day, hard max $20) sums usage that the **browser** reports (§5.2).

---

## 2. Provider inventory

| Provider                           | Kind                                 | Model ids (exact)                                                                                                                                                                      | Transport                                                                                                    | Where invoked                                                                                                                                                  | Ledger (`ai_ops.model_usage`)                                       | Status                                                                                 |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OpenAI                             | text LLM                             | `gpt-5.6-luna` (only model the adapter permits)                                                                                                                                        | SDK `openai@7.21.0`, Responses API, `store:false`, `maxRetries:0`                                            | `packages/model-gateway/src/providers/openai.ts:341-466`, registered `apps/q-api/src/main.ts:929-933`                                                          | yes, per attempt (`gateway.ts:499-518`)                             | IMPLEMENTED (primary)                                                                  |
| OpenAI                             | realtime voice                       | `gpt-realtime-mini`; input transcription `gpt-4o-transcribe` (changed today from mini)                                                                                                 | raw `fetch` POST `https://api.openai.com/v1/realtime/client_secrets`; browser WebRTC to `/v1/realtime/calls` | `packages/model-gateway/src/realtime/openai.ts:26-198`; broker `apps/q-api/src/voice/duplex/broker.ts`                                                         | yes, purpose `VOICE_REALTIME`, but from browser-reported usage      | IMPLEMENTED behind flag `CQ_VOICE_REALTIME` (off by default, `duplex/config.ts:45-47`) |
| OpenAI                             | images                               | `gpt-image-1` ($0.04/image est.)                                                                                                                                                       | raw `fetch` `https://api.openai.com/v1/images/generations`                                                   | `packages/model-gateway/src/images/openai.ts:15`                                                                                                               | yes, purpose `DOCUMENT`, cost ESTIMATED (`images/index.ts:214-236`) | IMPLEMENTED                                                                            |
| OpenAI                             | embeddings                           | `text-embedding-3-small` @ 1024 dims                                                                                                                                                   | raw `fetch` `https://api.openai.com/v1/embeddings`                                                           | `packages/q-embeddings/src/infrastructure/openai-provider.ts:43-60`; selected by `Q_EMBEDDING_PROVIDER=openai` (`packages/config/src/embeddings.ts:29,81,118`) | **no** (no usage/ledger code in file)                               | IMPLEMENTED, outside gateway                                                           |
| Google Gemini                      | text LLM                             | `gemini-3.5-flash-lite`, `gemini-3.5-flash` (routed); `gemini-3.8-flash` (catalog, dropped from routing)                                                                               | SDK `@google/genai@2.21.0`; rotates up to 2 keys                                                             | `providers/google.ts:473-560`                                                                                                                                  | yes                                                                 | IMPLEMENTED (FAST_CLASSIFICATION primary, fallback elsewhere)                          |
| Google Gemini                      | images                               | `gemini-3.1-flash-lite-image` in code; catalog row missing (§7.1); `gemini-2.5-flash-image` RETIRED                                                                                    | raw `fetch` `generativelanguage.googleapis.com/v1beta/models`                                                | `images/google.ts:17`, `images/config.ts:21-26`                                                                                                                | yes, but under the wrong model id                                   | BROKEN (accounting)                                                                    |
| Groq                               | text LLM                             | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`                                                                                                                        | SDK `groq-sdk@1.6.0`; rotates up to 4 keys                                                                   | `providers/groq.ts`; registered `main.ts:916-925` if `GROQ_API_KEY` set                                                                                        | n/a                                                                 | CONFIGURED-UNUSED: removed from every policy by `20261008120000`                       |
| Anthropic / DeepSeek / Qwen-direct | —                                    | —                                                                                                                                                                                      | —                                                                                                            | No SDK or endpoint found. `deepseek` appears only in `packages/contracts/src/providers/errors.ts`                                                              | —                                                                   | not present                                                                            |
| Deepgram                           | STT + voice agent + TTS              | listen `flux-general-en` / `flux-general-multi`; speak `aura-2-thalia-en` / `aura-2-orion-en`; agent "think" = `{type:"open_ai", model:"capital-q"}` pointed back at q-api's think URL | raw `fetch` (`/v1/auth/grant`, `/v1/speak`) + browser agent WS                                               | `apps/q-api/src/voice/providers/deepgram.ts:16-35,195-245`, `deepgram-speak.ts:31-35`                                                                          | no                                                                  | IMPLEMENTED (the "standard line")                                                      |
| ElevenLabs                         | TTS (+ Speech Engine)                | `eleven_v3_conversational` default, fallback `eleven_turbo_v2_5`; admin tuning `eleven_flash_v2`/`eleven_turbo_v2`                                                                     | SDK `@elevenlabs/elevenlabs-js` (server), `@elevenlabs/react` (web)                                          | `voice/providers/elevenlabs-speak.ts:109-123,218-240`, `elevenlabs.ts`, `elevenlabs-admin.ts`; web `features/voice/provider/elevenlabs-session.ts`             | no                                                                  | IMPLEMENTED                                                                            |
| Recall.ai                          | meeting bot + transcription          | transcriber `meeting_captions` (default) or `recallai_streaming`                                                                                                                       | raw `fetch` `https://{RECALL_REGION}.recall.ai/api/v1`                                                       | `apps/q-api/src/composition/recall-bots.ts:120-135,279-290`                                                                                                    | no                                                                  | IMPLEMENTED (not inspected deeply)                                                     |
| Tavily                             | web search                           | —                                                                                                                                                                                      | SDK (per comments)                                                                                           | `packages/q-research/src/providers/tavily.ts`                                                                                                                  | no                                                                  | IMPLEMENTED                                                                            |
| SerpAPI                            | web search                           | —                                                                                                                                                                                      | `fetch` `https://serpapi.com/search.json`                                                                    | `q-research/src/providers/serpapi.ts:31`                                                                                                                       | no                                                                  | IMPLEMENTED                                                                            |
| Bright Data                        | SERP proxy + LinkedIn profile scrape | —                                                                                                                                                                                      | `fetch` `api.brightdata.com/request`, `/datasets/v3/scrape`                                                  | `q-research/src/providers/brightdata.ts:33-34,279-282`                                                                                                         | no                                                                  | IMPLEMENTED                                                                            |
| Cloudflare Stream                  | video                                | —                                                                                                                                                                                      | adapter                                                                                                      | `packages/media/src/infrastructure/cloudflare-stream-video-provider.ts`; env `CLOUDFLARE_STREAM_*`                                                             | n/a                                                                 | not inspected (other investigator)                                                     |
| Tavus                              | —                                    | —                                                                                                                                                                                      | —                                                                                                            | Only appears as a seed label ("tavus-20") in `apps/q-api/src/composition/instructions/engine.ts:443`. No provider integration                                  | —                                                                   | not present                                                                            |
| Self-hosted TEI                    | embeddings                           | `Qwen/Qwen3-Embedding-0.6B`                                                                                                                                                            | HTTP                                                                                                         | `render.yaml:47-55` (superseded); removed on Railway (1 GB cap) per `openai-provider.ts:22-25`                                                                 | —                                                                   | CONFIGURED-UNUSED on hosted                                                            |

---

## 3. Gateway mechanics (IMPLEMENTED; unit-tested, see 13)

Evidence: `evidence/providers/gateway-route.md`, `eligibility.md`, `budgets-and-turn-reader.md`.

- **Catalog.** `ai_ops.providers/models/model_prices/routing_policies` is read through `createPostgresModelCatalog` with a 60 s TTL cache (`infrastructure/postgres-catalog.ts:201-203`). It is re-indexed on every request (`gateway.ts:668-670`).
- **Policy selection.** Active policies for the task class whose sensitivity class covers the request are considered; the lowest covering ceiling and highest version wins (`policy/eligibility.ts:114-131`). All seven seeded policies are `sensitivity_class='RESTRICTED'` (`20260907090000…sql:316-328`), so one policy per task class.
- **Eligibility order.** Every candidate is checked in this order (`eligibility.ts:254-370`):
  1. provider ACTIVE
  2. adapter registered
  3. process-local health
  4. model ACTIVE and effective
  5. **sensitivity vs model ceiling, and vs the provider-justified ceiling** (skipped when `synthetic`)
  6. tenant policy
  7. capabilities
  8. output and context limits
  9. quality floor
  10. latency
  11. price known
  12. estimated cost ≤ min(request budget, policy ceiling)
- **Provider-justified ceiling** (`eligibility.ts:77-93`):

  | Provider privacy class                                 | Ceiling      |
  | ------------------------------------------------------ | ------------ |
  | UNREVIEWED                                             | PUBLIC       |
  | TRAINING_PERMITTED                                     | PUBLIC       |
  | NO_TRAINING_DEFAULT_RETENTION                          | INTERNAL     |
  | NO_TRAINING_ZERO_RETENTION + `supports_zero_retention` | CONFIDENTIAL |
  | ENTERPRISE_CONTRACT                                    | CONFIDENTIAL |

  No provider class reaches HIGHLY_CONFIDENTIAL or RESTRICTED.

- **Retries.** At most 2 attempts per candidate (`gateway.ts:152`). Backoff is 300 ms base, 4 s cap, with jitter; retry-after is capped at 10 s (`153-155, 241-254`). With another candidate waiting, RATE_LIMIT and TIMEOUT go to the next candidate instead of retrying (`1001-1009`). `INVALID_REQUEST` also falls back (`packages/contracts/src/model/index.ts:294-300`).
- **Budget.** Retries and fallbacks count against `request.budget.maxEstimatedCostUsd` and `maxAttempts` (`gateway.ts:777-796`).
- **`firstAttemptTimeoutMs`.** Applies only to attempt 0, and only when another eligible candidate waits (`gateway.ts:807-812`). Callers: the turn reader under SYNTHETIC_DEMO (`q/turn-reader.ts:310`) and the interview agent (`apps/q-api/src/voice/interview-agent.ts:1292,1353`).
- **Hedge.** Configured per policy (`hedge_after_ms`). The non-streaming first attempt also asks the next candidate after `hedgeAfterMs`, and the loser is aborted (`gateway.ts:837-908, 1077-1153`). Only `fast_classification.v1` has a hedge (2000 ms), set by `20261207163000…sql:33-36`. A stalled flash-lite read therefore **pays for a luna call as well**.
- **Streaming.** `onTextDelta` disables retry and fallback once anything has been emitted (`gateway.ts:961-978`). Streaming requests are never hedged (`gateway.ts:842`).
- **Ledger.** One `ai_ops.model_usage` row per attempt. The write is autonomous; a failed write is logged and counted but never fails the answer (`gateway.ts:256-269, 499-518`; `infrastructure/postgres-usage.ts:14-33`). Cost basis is `PRICE_SNAPSHOT` when the provider returned usage, else `ESTIMATED` (chars/4) (`gateway.ts:345-350`). `purpose` is derived from attribution (`20261126090000_model_usage_purpose.sql`).
- **Health.** Process-local (`createProcessLocalProviderHealth`, `apps/q-api/src/main.ts:1003`). It is not shared across q-api, api and workers or across replicas. An account-exhausted flag skips the provider (`providers/openai.ts:99-132`).
- **Thinking and reasoning.** OpenAI maps NONE/LOW/MEDIUM/HIGH to `reasoning.effort` and requests no summary (`providers/openai.ts:74-81, 387-389`). Gemini 3 cannot turn thinking off; it gets the minimum level, with `includeThoughts:false` (`providers/google.ts:74-80, 583`). Thought tokens are billed as output (`policy/cost.ts:64`).

### 3.1 Per-task budgets (code, `packages/model-gateway/src/q/index.ts:401-456`)

| Task class                             | Capability mapped (`index.ts:365-382`) | maxAttempts | max cost USD | maxOutputTokens | attempt timeout                                                            |
| -------------------------------------- | -------------------------------------- | ----------- | ------------ | --------------- | -------------------------------------------------------------------------- |
| FAST_CLASSIFICATION / TAXONOMY_MAPPING | CLASSIFY                               | 3           | 0.02         | 1,024           | 20 s                                                                       |
| STRUCTURED_EXTRACTION                  | PREPARE_ACTION                         | 3           | 0.05         | 6,144           | 30 s                                                                       |
| NORMAL_DIALOGUE                        | ANSWER                                 | 3           | 0.10         | 4,096           | 45 s                                                                       |
| EVIDENCE_SYNTHESIS / COMPARISON        | ASSESS / COMPARE                       | 3           | 0.50         | 8,192           | 60 s                                                                       |
| DEEP_INVESTIGATION                     | INVESTIGATE                            | 3           | 1.00         | 4,096           | 90 s                                                                       |
| Turn reader (FAST_CLASSIFICATION)      | —                                      | 2           | 0.01         | 1,200           | 6 s; first attempt shorter under SYNTHETIC_DEMO (`turn-reader.ts:100-130`) |

Call-site counts by `taskClass:` literal across apps and packages: STRUCTURED_EXTRACTION 74, NORMAL_DIALOGUE 41, FAST_CLASSIFICATION 40, EVIDENCE_SYNTHESIS 7, DEEP_INVESTIGATION 2, REALTIME_VOICE 2. These counts include tests. `OWN_COMPANY_QUESTION` and similar names are Context Firewall task classes, not model task classes.

---

## 4. Net routing (data), in migration order

Evidence: `evidence/providers/routing-migrations.md`.

| Step | Migration                 | Effect                                                                                                                                                                                                                         |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `20260907090000`          | Seeds google (UNREVIEWED) and groq (UNREVIEWED), 4 models, 7 policies (`fast_classification.v1` … `deep_investigation.v1`, all `RESTRICTED` sensitivity class, cost ceilings 0.02–1.00)                                        |
| 2    | `20260914090000`          | groq reviewed as NO_TRAINING_ZERO_RETENTION, ZDR "asserted by the human operator … an assertion, not a verification"                                                                                                           |
| 3    | `20260919…` → `20260926…` | Gemini demo raise to CONFIDENTIAL, then reverted to PUBLIC                                                                                                                                                                     |
| 4    | `20261006090000`          | OpenAI added "diagnostic-only", UNREVIEWED; `gpt-5.6-luna` $0.20 / $0.02 cached / $1.20 per M                                                                                                                                  |
| 5    | `20261006100000`          | OpenAI marked NO_TRAINING_ZERO_RETENTION + `supports_zero_retention=true` ("operator asserts ZDR is enabled"); luna ceiling CONFIDENTIAL; first dialogue fallback                                                              |
| 6    | `20261008120000`          | Groq dropped everywhere; `gemini-3.5-flash` added. Its price is an "operator estimate" and its ceiling is copied from flash-lite (PUBLIC). **Quality floors HIGH → STANDARD** for synthesis, comparison and deep investigation |
| 7    | `20261008130000`          | **luna first for every policy**                                                                                                                                                                                                |
| 8    | `20261110000000`          | `fast_classification.v1` back to flash-lite first, luna fallback (measured p50 1.9 s luna vs 1.0 s flash-lite)                                                                                                                 |
| 9    | `20261207163000`          | `hedge_after_ms=2000` on fast_classification                                                                                                                                                                                   |

**Effective now:**

| Policy                                                   | Order                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| normal_dialogue, structured_extraction, taxonomy_mapping | `gpt-5.6-luna` → `gemini-3.5-flash-lite` → `gemini-3.5-flash`             |
| evidence_synthesis, comparison, deep_investigation       | `gpt-5.6-luna` → `gemini-3.5-flash` → `gemini-3.5-flash-lite`             |
| fast_classification                                      | `gemini-3.5-flash-lite` → `gpt-5.6-luna` → `gemini-3.5-flash` (hedge 2 s) |

**Eligibility caveat.** For any request above PUBLIC sensitivity, both Gemini models are ineligible unless SYNTHETIC_DEMO is attested and declared (`eligibility.ts:295-309`, ceilings PUBLIC from `20260926090000`). Without the attestation:

- Non-public FAST_CLASSIFICATION has only luna eligible, so the hedge is inert.
- A luna outage leaves non-public dialogue with **no fallback**.

**Migration-order note.** All of these files were (re)added on 2026-10-07 in commit `fa577326` (recovery branch). Several carry future timestamps (`202611*`, `202612*`). `20261008*` sorts _before_ `20261110*`. The net result above assumes strict filename order. I did not verify which migrations are applied on the hosted database.

---

## 5. Realtime voice and caps

Evidence: `evidence/providers/realtime-duplex.md`.

### 5.1 Session minting (IMPLEMENTED behind flag)

- The server POSTs `client_secrets` with model, instructions, tools, voice and `semantic_vad`. It sets `create_response: false` when turns are server-routed and `interrupt_response: false` (`realtime/openai.ts:79-152`).
- The secret TTL is 60 s, for opening only (`duplex/config.ts:53`). The browser never holds the API key.
- Prices are hard-coded in code (`realtime/openai.ts:33-56`) **and** in catalog metadata (`20261203090000…sql:31`). They could drift apart.
- The transcriber changed today to `gpt-4o-transcribe` ($2.50 / $10 text, $6 audio per M) from mini (`realtime/openai.ts:42-56`).

### 5.2 Duplex daily cap (PARTIAL)

| Setting         | Default           | Env var and bounds                              |
| --------------- | ----------------- | ----------------------------------------------- |
| Daily cap       | $1                | `CQ_VOICE_REALTIME_DAILY_CAP_USD`, bounded 0–20 |
| Session reserve | $0.25             | —                                               |
| Max session     | 10 min            | —                                               |
| Idle cutoff     | 30 s              | —                                               |
| Response        | 800 output tokens | —                                               |

Defaults: `duplex/config.ts:45-57, 87-92`.

- Cap check at open: spent + reserved + reserve > cap → fallback `CAP_REACHED`. An unreadable ledger fails closed (`broker.ts:653-664`).
- `spentTodayUsd` sums **all tenants'** `VOICE_REALTIME` rows since 00:00 UTC (`duplex/spend.ts:19-33`).
- **Trust gap.** The rows come from `usage` reports the **browser** posts (`apps/web/src/features/voice/provider/duplex-line.ts:44,371-405,1315-1317`, then `broker.ts:1017-1043`). The server cannot see the WebRTC call's real usage:
  - A tab that never reports, or a modified client, spends realtime minutes that are never ledgered.
  - The remaining bounds are the reserve held at open, `maxSessionMs`, and the browser cooperating with rejoin.
  - Hypothesis, not exploited: the WebRTC call itself is between the browser and OpenAI, and I found no server-side sideband hangup.
- **Text inference has no aggregate daily or monthly cap.** It has only per-request `maxEstimatedCostUsd` and per-policy `cost_ceiling_usd`. A loop of requests (for example the Work agent's review rounds, or the hedge) is bounded only per call. I found no `dailyCap` outside duplex, q-daily editions, Q2Q (`Q2Q_DAILY_CAP=6`, `packages/q-orchestrator/src/work/types.ts:60`) and `DELEGATION_DAILY_CAP` (`apps/q-api/src/composition/instructions/engine.ts:319`); none of these is money.

---

## 6. Is model selection centralized?

- **Grep result.** `from "openai" | "@google/genai" | "groq-sdk"` appears only in `packages/model-gateway/src/providers/{openai,google,groq}.ts`. Raw provider URLs appear only in:
  - `model-gateway/src/images/{openai,google}.ts`
  - `model-gateway/src/realtime/openai.ts`
  - `q-embeddings/src/infrastructure/openai-provider.ts`

  So text LLMs are centralized: IMPLEMENTED.

- **Paths that bypass routing policy or eligibility:**
  1. **Embeddings (OpenAI).** Direct fetch. No routing policy, no sensitivity check, no `ai_ops.model_usage` row. Eligibility is argued in a comment only: "OpenAI is already the Model Gateway's primary reviewed provider … never a founder-private field (the representation builders' contract)" (`openai-provider.ts:29-33`).
  2. **Images.** Model choice comes from `IMAGE_MODEL_CONFIG` constants (`images/config.ts:20-34`), not policies. The catalog says prompts carry only a title, a description and colours (`20261215090000…sql:14`).
  3. **Realtime.** The model is a constant; eligibility is done by the broker against a context plan (comment `20261203090000…sql:11-13`). This was not traced in depth.
  4. **Voice vendors.** Deepgram and ElevenLabs are not LLMs. The Deepgram agent's "think" step is delegated back to q-api (`deepgram.ts:237-243`), so the LLM still goes through the gateway.
- **Hard-coded model allow-list in the OpenAI adapter.** `if (request.modelCode !== OPENAI_TEST_MODEL) throw INVALID_REQUEST` (`providers/openai.ts:364-375`). This contradicts "routing is data": a migration naming another OpenAI model would fail every call, and fall back because INVALID_REQUEST allows fallback.

---

## 7. Defects and cost or capability mismatches

### 7.1 CONFIRMED — catalog UUID collision (accounting BROKEN)

- `20261203090000_model_usage_voice_realtime.sql:28` inserts `a2000000-0000-4000-8000-000000000022` = `gpt-realtime-mini`, `on conflict (id) do nothing`.
- `20261215090000_image_model_flash_lite.sql:11` inserts the **same id** = `gemini-3.1-flash-lite-image`, `on conflict (id) do nothing`. It silently no-ops, then retires `gemini-2.5-flash-image` (`:17-20`).
- `packages/model-gateway/src/images/config.ts:21-26` records Google image usage with `providerId` google + `modelId …022`. Every Gemini image row therefore points at `gpt-realtime-mini` while its `provider_id` says google.
- Tests are inconsistent:
  - `supabase/tests/database/rls/320_ai_ops.test.sql:38-44` asserts exactly ten models with no `gemini-3.1-flash-lite-image`, consistent with the collision.
  - `882_document_jobs.test.sql:85-86` asserts `status` of `…022` is ACTIVE with the message "gemini-3.1-flash-lite-image is the active Gemini image model". It passes vacuously against the realtime row.
- Impact:
  - Per-model usage and cost views are wrong.
  - The realtime cap is unaffected, because it filters `purpose='VOICE_REALTIME'` and images are `DOCUMENT`.
  - The image adapter keeps calling the model code from config whatever the catalog says.

### 7.2 Quality floors lowered; one STANDARD/FAST model does HIGH-class work (capability gap)

- `20261008120000…sql:13-17,69-75` set evidence synthesis, comparison and deep investigation floors to STANDARD "for the demo".
- `gpt-5.6-luna` is catalogued `STANDARD`/`FAST` (`20261006090000…sql:32-34`) and is now first for these policies.
- `DEEP_INVESTIGATION` and `EVIDENCE_SYNTHESIS` (assessments, diligence summaries) therefore run on a model the catalog itself rates below the original HIGH floor.

### 7.3 Expensive model for cheap jobs, or duplicated spend

- The FAST_CLASSIFICATION hedge (2 s) pays for luna on every slow flash-lite read (`gateway.ts:837-908`). It is bounded, but doubles the cost of the stalls.
- `gpt-4o-transcribe` replaced mini for realtime input transcription. That is a deliberate quality trade: about 2x the audio rate of mini (from code comment; mini's price is not in the repo).
- All non-classification task classes, including TAXONOMY_MAPPING and STRUCTURED_EXTRACTION, run on luna first. Luna is cheap ($0.20/$1.20 per M), so this is not a cost problem as such.

### 7.4 Stale, contradictory provider documentation (config drift)

- `packages/config/src/model-providers.ts:116-124` says OpenAI is "for diagnosis only … No routing policy names it". This is false since `20261006100000` and `20261008130000`.
- `providers/openai.ts:34-50` has the same stale header.
- `.railway/railway.ts:76-80` says `CQ_SYNTHETIC_DEMO_ROUTING` "is deliberately absent … admits only local/test … throws otherwise". This is false: `synthetic-demo.ts:175-215` admits `staging` with `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED` + project ref.
- `.railway/railway.ts:101-106` lists no `OPENAI_API_KEY`. The deployed key must have been set outside this IaC.
- `render.yaml:1` marks the file SUPERSEDED (Railway, ADR 0014). `CLAUDE.md` still says Render per ADR 0001.

### 7.5 Price data quality

- `gemini-3.5-flash` price is an "Operator estimate … verify before launch" (`20261008120000…sql:53-54`).
- The qwen price came from a third-party listing (`20260918090000…sql`).
- Realtime audio prices are held only in metadata and code constants; `model_prices` has text columns only (`20261203090000…sql:31,37`).
- Gemini key rotation (`providers/google.ts:473-541`) and Groq rotation over up to 4 keys exist "so one exhausted free tier does not stop Q" (`config/src/model-providers.ts:104-115`). Spreading load over several free-tier keys may breach vendor terms. Unverified: legal review needed.

### 7.6 Uncounted vendor spend

Deepgram, ElevenLabs, Recall.ai, Tavily, SerpAPI, Bright Data and OpenAI embeddings write no cost rows. The only tracked AI spend is `ai_ops.model_usage` (text, images, duplex). There is no in-repo view of total provider spend.

---

## 8. ChatGPT subscription vs API billing

- No code path uses a ChatGPT (consumer, Plus or Team) subscription. All OpenAI use is API-key billing through `OPENAI_API_KEY` / `OPEN_AI_API_KEY` (`packages/config/src/model-providers.ts:125-128`).
- Comments describe the account as holding "a few dollars" (`20261006090000…sql:35`, `providers/openai.ts:366-367`). `CLAUDE.md` describes "OpenAI (a $5 top-up)".
- A ChatGPT subscription does **not** fund API usage. The API account must be topped up separately.
- The adapter classes `credit_balance_exhausted` and `insufficient_quota` as account-exhausted, so it skips rather than retries (`providers/openai.ts:94-132`). Since OpenAI is primary for six of seven policies, an exhausted API balance degrades every non-public request:
  - with no attestation: no eligible fallback, so failure;
  - with the attestation: a Gemini free-tier fallback.

---

## 9. Open questions

1. Which env holds the hosted q-api: `CQ_SYNTHETIC_DEMO_ROUTING`, `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED`, `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF`, `OPENAI_API_KEY`, `CQ_VOICE_REALTIME`? The startup log line "synthetic-demo attestation accepted" / "no synthetic-demo attestation" (`apps/q-api/src/main.ts:1019-1029`) answers this.
2. Is OpenAI ZDR actually enabled on the org? The migrations record an operator assertion only (`20261006100000…sql:18-21`).
3. Which migrations are applied on the hosted database, and in what order? This matters most for the future-dated files.
4. Actual monthly cost: query `ai_ops.model_usage` grouped by model and purpose. Not done (read-only, no DB access).
