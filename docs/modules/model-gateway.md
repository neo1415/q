# Model Gateway (`@capital-q/model-gateway`, CQ-Q-005)

**Purpose.** The one provider-neutral inference boundary in Capital Q (doc 12
§24). Business and Q code request a TASK CLASS under a SENSITIVITY with a
BUDGET; the gateway chooses a configured, eligible provider/model from data,
executes with bounded retry, fallback, timeouts and cancellation, validates
structured output, prices the call from a versioned snapshot, writes the
usage ledger and emits telemetry. It owns none of the meaning: no prompt
(CQ-Q-006), no Context Firewall (CQ-Q-004), no retrieval (CQ-RAG), no tool
(CQ-Q-007), no approval (CQ-Q-008), no memory, no knowledge.

```
Q                         ≠ model provider
Model Gateway             ≠ Gemini ≠ Groq
task class                ≠ specific model name
model output              ≠ canonical truth
provider success          ≠ Q correctness
free ≠ safe · cheap ≠ bad · expensive ≠ good
available model           ≠ eligible model
Context Firewall decision ≠ provider data-use eligibility
Q knows                   ≠ provider may receive
```

## Ownership and layout

| Where                                       | What                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/model`              | INTERNAL vocabulary: task classes, capabilities, quality/latency classes, failure classes, request, budget, usage, cost, result, eligibility reasons. No vendor name. |
| `packages/model-gateway/src/ports.ts`       | `ModelProvider`, execution context, registry, catalog port, usage ledger port, tenant policy port, health port.                                                       |
| `packages/model-gateway/src/policy/*`       | Deterministic eligibility and ordering, cost arithmetic, process-local health, structured-output acceptance.                                                          |
| `packages/model-gateway/src/gateway.ts`     | `createModelGateway(...).execute(request, { schema, signal })`.                                                                                                       |
| `packages/model-gateway/src/providers/*`    | `fake` (tests), `google` (`@google/genai`), `groq` (`groq-sdk`). The only SDK imports in the repository, enforced by lint.                                            |
| `packages/model-gateway/src/infrastructure` | PostgreSQL catalog loader (cached) and usage ledger writer.                                                                                                           |
| `packages/model-gateway/src/q`              | The Q answer seam over the gateway (`createModelGatewayQAnswer`).                                                                                                     |
| `supabase/migrations/20260907090000_*`      | Schema `ai_ops`: providers, models, model_prices, routing_policies, model_usage, seeds.                                                                               |
| `apps/q-api/src/main.ts`                    | Composition: keys → adapters → registry → gateway → answer seam.                                                                                                      |

## ModelProvider boundary

```ts
type ModelProvider = {
  code: ModelProviderCode;
  capabilities(): { structuredOutput; streaming; cancellation };
  generate(
    request: ModelProviderRequest,
    context: ModelExecutionContext,
  ): Promise<ModelProviderResult>;
};
```

An adapter maps the provider-neutral request (model code, messages, output
spec with JSON Schema, max output tokens, temperature, reasoning level) to
the vendor API and maps back text, usage, finish status, an opaque
reference and errors as `ModelProviderFailure` with a stable class. It does
not retry (SDK retries are disabled), does not route, does not budget,
does not validate schemas, does not account. Nothing vendor-typed leaves
it, and no key is stored on it: the key lives in the closure.

## Task classes

`FAST_CLASSIFICATION`, `STRUCTURED_EXTRACTION`, `TAXONOMY_MAPPING`,
`NORMAL_DIALOGUE`, `EVIDENCE_SYNTHESIS`, `COMPARISON`, `DEEP_INVESTIGATION`,
`REALTIME_VOICE`, `GUARDRAIL`, `EMBEDDING` (doc 12 §24.3). This version
executes the seven text classes only. `EMBEDDING` is CQ-RAG-002,
`REALTIME_VOICE` is later, and `GUARDRAIL` stays deterministic: no routing
policy exists for it, so a request for it fails as `POLICY_INELIGIBLE`
rather than quietly calling a model.

Q capability → task class (answer seam): ANSWER → NORMAL_DIALOGUE,
INVESTIGATE → DEEP_INVESTIGATION, ASSESS → EVIDENCE_SYNTHESIS, COMPARE →
COMPARISON, CLASSIFY → FAST_CLASSIFICATION, PREPARE_ACTION →
STRUCTURED_EXTRACTION.

## Routing factors and order

For the policy that covers the task class and sensitivity (lowest covering
`sensitivity_class`, highest version), every candidate in
`preferred_models ++ fallback_models` is judged in this fixed order, and
the first refusal is the recorded reason:

1. provider `status` (kill switch)
2. adapter configured (key present)
3. process-local health (temporarily failing)
4. model `status` and effective period
5. **sensitivity ≤ model `sensitivity_ceiling`**
6. tenant provider policy
7. required capabilities (structured output, etc.)
8. output limit and context window against the token estimate
9. quality floor (policy and request), latency target
10. estimated cost ≤ min(request budget, policy ceiling); unknown price = ineligible

Privacy (5) is decided before price (10), and the same judgement applies
to a fallback as to a first choice. No LLM chooses: routing is a few map
lookups.

## Initial routing matrix (routing policy v1, data)

| Task class            | Preferred             | Fallback            | Floor    | Cost ceiling |
| --------------------- | --------------------- | ------------------- | -------- | ------------ |
| FAST_CLASSIFICATION   | gemini-3.5-flash-lite | openai/gpt-oss-20b  | BASIC    | $0.02        |
| STRUCTURED_EXTRACTION | gemini-3.5-flash-lite | openai/gpt-oss-20b  | BASIC    | $0.05        |
| TAXONOMY_MAPPING      | gemini-3.5-flash-lite | openai/gpt-oss-20b  | BASIC    | $0.02        |
| NORMAL_DIALOGUE       | openai/gpt-oss-120b   | gemini-3.8-flash    | STANDARD | $0.10        |
| EVIDENCE_SYNTHESIS    | gemini-3.8-flash      | openai/gpt-oss-120b | HIGH     | $0.50        |
| COMPARISON            | gemini-3.8-flash      | openai/gpt-oss-120b | HIGH     | $0.50        |
| DEEP_INVESTIGATION    | gemini-3.8-flash      | openai/gpt-oss-120b | HIGH     | $1.00        |

An MVP hypothesis, not a quality claim: CQ-Q-010 evals decide. Changing it
is a new `routing_policies` row (`code` like `normal_dialogue.v2`), never
code; every call and every completed run records the policy code it ran
under (`q_runtime.runs.model_policy_version`).

## Providers and models (seeded 2026-09-05, verified against provider docs)

| Provider | Model                 | Context   | Max out | Structured | Ceiling  | Quality  | Price in/out per 1M                             |
| -------- | --------------------- | --------- | ------- | ---------- | -------- | -------- | ----------------------------------------------- |
| google   | gemini-3.5-flash-lite | 1,048,576 | 65,536  | yes        | PUBLIC   | STANDARD | $0.30 / $2.50                                   |
| google   | gemini-3.8-flash      | 1,048,576 | 65,536  | yes        | PUBLIC   | HIGH     | $0.75 / $3.75 to 2026-12-31, then $1.50 / $7.50 |
| groq     | openai/gpt-oss-20b    | 131,072   | 65,536  | yes        | INTERNAL | STANDARD | $0.075 / $0.30                                  |
| groq     | openai/gpt-oss-120b   | 131,072   | 65,536  | yes        | INTERNAL | HIGH     | $0.15 / $0.60                                   |

Prices are versioned rows with source URL and verification time; the 2027
Gemini price is already a second row. Cost is computed from the row in
force at call time and never rewritten. Free-tier billing is not modelled:
the model's price is what a route costs the architecture.

## Privacy eligibility (doc 15 §61-62, §88; doc 13 §120)

A model's `sensitivity_ceiling` is the reviewed policy record. Both V1
providers are recorded as `privacy_policy_class = UNREVIEWED`:

- **Gemini (free/unverified account):** the Developer API free tier states
  that content is used to improve Google products. Ceiling **PUBLIC**.
  Synthetic and public material only; INTERNAL and above never reach it,
  whatever a key allows. Possession of a key does not imply a paid tier.
- **Groq:** provider documentation describes no training on inference data
  and no default retention, but the governing Services Agreement could not
  be verified from a primary document in this packet. Ceiling **INTERNAL**.
  CONFIDENTIAL and above are refused until a reviewed data change raises it.

Consequence today: the Q answer seam declares the firewall plan's
`maxSensitivity` as the request sensitivity, so a run whose plan admits
CONFIDENTIAL context is refused by every seeded model
(`POLICY_INELIGIBLE` → public `Q_UNAVAILABLE`) even though only the
person's own words are sent. That is deliberate until retrieval exists and
can declare what was actually assembled, and until a provider is reviewed.
Raising a ceiling is an `ai_ops` data change after review, never a code
change and never an availability flag.

A tenant can narrow eligibility (`TenantModelPolicy`: denied or allowed
provider codes), never widen it.

## Budget, cost, ledger

Every request carries `budget`: max attempts (retries and fallbacks
together, ≤6), max estimated cost, max output tokens, per-attempt timeout,
optional max input tokens. Before an attempt the gateway estimates the
attempt's cost (input estimate ≈ chars/4, output = the full output budget)
and refuses routes and further attempts that would exceed the budget.
After an attempt it prices provider-reported usage (`PRICE_SNAPSHOT`) or its
own estimate (`ESTIMATED`); `UNPRICED` means unknown, never free.

`ai_ops.model_usage` gets one append-only row per real attempt, success or
failure: tenant, user, run, task class, provider, model, policy, attempt,
tokens, latency, cost with basis, success, failure class, correlation id.
No prompt, no response, no error text. A ledger write failure is logged and
counted; it never fails the answer and never rolls back with a domain
transaction.

## Reliability

- **Timeouts:** every attempt runs under `AbortSignal.timeout(attemptTimeoutMs)` combined with the caller's signal; adapters pass it to the SDK.
- **Retry:** same candidate, at most once, only for TRANSIENT, RATE_LIMIT, PROVIDER_OUTAGE, TIMEOUT, INVALID_MODEL_OUTPUT; exponential backoff from 300 ms with jitter, capped at 4 s, honouring `retry-after` up to 10 s.
- **Fallback:** next eligible candidate for TRANSIENT, RATE_LIMIT, PROVIDER_OUTAGE, TIMEOUT, INVALID_MODEL_OUTPUT, CONTEXT_LIMIT, AUTHENTICATION, PERMANENT. Never for CANCELLED, BUDGET_EXCEEDED, POLICY_INELIGIBLE, INVALID_REQUEST. A fallback is judged by the full eligibility sequence, so it cannot lower privacy.
- **Cancellation:** the caller's signal (the orchestrator's) aborts the provider call; a cancelled request never retries and never falls back.
- **Health:** three availability failures within a minute skip a provider for thirty seconds, in this process only. Health can only un-choose an eligible provider.
- **Kill switch:** `ai_ops.providers.status = 'DISABLED'` or `ai_ops.models.status = 'DISABLED'`; the catalog cache is 60 s.

## Structured output

`output: { kind: "STRUCTURED", schemaName, jsonSchema }` plus the Zod schema
in `execute(..., { schema })`. Providers are asked for JSON against the
schema (Gemini `responseJsonSchema`, Groq `json_schema`), the text is
decoded, and only what the Zod schema accepts is returned. Anything else is
INVALID_MODEL_OUTPUT: retried once, then the next candidate, never
accepted, never persisted.

## Failure normalization

`TRANSIENT`, `RATE_LIMIT`, `PROVIDER_OUTAGE`, `TIMEOUT`,
`INVALID_MODEL_OUTPUT`, `INVALID_REQUEST`, `CONTEXT_LIMIT`,
`AUTHENTICATION`, `POLICY_INELIGIBLE`, `BUDGET_EXCEEDED`, `CANCELLED`,
`PERMANENT`. Adapters keep the vendor's message and body on `cause` only.
The answer seam maps classes to Q diagnostic codes (TIMEOUT →
MODEL_PROVIDER_TIMEOUT, CANCELLED → RUN_CANCELLED, BUDGET_EXCEEDED →
BUDGET_EXCEEDED, everything else → MODEL_PROVIDER_UNAVAILABLE), and the
public projection turns those into one plain sentence.

## Secrets

`GEMINI_API_KEY` and `GROQ_API_KEY` are read once by
`@capital-q/config/model-providers` into `ProviderCredential` values that
stringify and serialise as `[redacted]`; `reveal()` is called at the q-api
composition root and nowhere else. Each is optional: an unconfigured
provider is simply not registered. Structural tests assert no SDK import
outside the adapters, no key name in browser-reachable code or contracts,
no `process.env` read outside config, no `NEXT_PUBLIC_` variant, and no
provider/model field on the public Q request.

## Observability

Spans `q.model_gateway.execute` (task class, sensitivity, policy, run and
tenant ids) and `q.model_gateway.provider_attempt` (provider, model,
attempt, candidate index, result, latency). Metrics with bounded labels
(provider, model, task_class, result): requests, successes, failures,
attempts, fallbacks, rate limits, policy-ineligible, budget-rejected,
usage-record failures, provider latency, tokens in/out, estimated cost. No
prompt, context, output or raw provider response is logged or traced.

## Q integration

The orchestrator's answer seam is `createModelGatewayQAnswer`. Since
CQ-Q-006 it renders the governed prompt bundle (`docs/modules/q-core.md`)
and, since CQ-Q-007, runs the bounded tool loop described in
`docs/modules/q.md`, stores the validated answer as the run's `Q` message
and returns the routing policy code and prompt bundle version, which
`complete` stamps on the run. A gateway failure returns a coded outcome;
the orchestrator fails the run with it.

## Tools (CQ-Q-007)

A request may carry `tools`: canonical `ModelToolDefinition`s (name,
description, input JSON Schema) the Tool Registry offered for this run,
with a TEXT output only. The gateway adds `TOOL_CALLING` to the required
capabilities, hands the definitions to the adapter, and returns either
text or `TOOL_CALLS` (decoded proposals) — a proposal for a tool the
request did not offer is `INVALID_MODEL_OUTPUT`, retried and fallen back
like any other bad output. Conversation messages gained an ASSISTANT
`toolCalls` field and a `TOOL` role for bounded JSON results (≤ 32k chars).

The Google adapter projects definitions as `functionDeclarations` (bounds
keywords stripped exactly as for response schemas), never enabling search
grounding, code execution or URL context; it assigns `gen_<n>` ids when
Gemini omits one and never echoes those back. The Groq adapter projects
OpenAI-style function tools with `tool_choice: auto`, decodes each call's
JSON arguments (malformed → `INVALID_MODEL_OUTPUT`), and keeps
`reasoning_format: hidden`. Neither adapter executes anything: proposals go
back through the gateway to the registry.

Nothing a model says writes canonical company, investor, evidence,
relationship or knowledge truth; the only write is a conversation message.

## Live tests

`pnpm test:live-model` runs `packages/model-gateway/test/providers.live.test.ts`
through `scripts/live-model-tests.mjs`, which reads only the two key names
from `.env.local` into the child process and prints presence by name. Real
calls, synthetic public input, tiny budgets. Excluded from `pnpm test` and
`pnpm test:integration`.

## Explicit deferrals

Approvals → CQ-Q-008 · tool calls combined with provider JSON mode → when a
provider supports both on one call ·
SSE → CQ-Q-009 · eval harness → CQ-Q-010 · retrieval and context assembly →
CQ-RAG · embeddings (`EMBEDDING`) → CQ-RAG-002 · realtime voice → later ·
provider data-use review (raising ceilings) → a reviewed `ai_ops` change ·
tenant policy persistence → later packet · additional providers (Anthropic,
OpenAI direct, DeepSeek, Qwen, OpenRouter, local) → after the eval baseline ·
streaming through the gateway → with SSE.
