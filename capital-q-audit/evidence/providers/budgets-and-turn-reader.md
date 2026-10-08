# Per-task budgets and turn reader

Why included: Budgets, timeouts and task-class mapping for Q answers.

## `packages/model-gateway/src/q/index.ts` lines 362-456

```ts
  362  /** Calls in total per turn (raised from 6, autopilot P1 2026-10-06). */
  363  export const Q_TOOL_LOOP_MAX_CALLS = 10;
  364
  365  export function taskClassForCapability(
  366    capability: QCapability,
  367  ): ModelTextTaskClass {
  368    switch (capability) {
  369      case "ANSWER":
  370        return "NORMAL_DIALOGUE";
  371      case "INVESTIGATE":
  372        return "DEEP_INVESTIGATION";
  373      case "ASSESS":
  374        return "EVIDENCE_SYNTHESIS";
  375      case "COMPARE":
  376        return "COMPARISON";
  377      case "CLASSIFY":
  378        return "FAST_CLASSIFICATION";
  379      case "PREPARE_ACTION":
  380        return "STRUCTURED_EXTRACTION";
  381    }
  382  }
  383
  384  /** Q's conversational work happens in INVESTOR-facing evaluation or DEBRIEF; never assessment here. */
  385  export function operatingModeForCapability(
  386    capability: QCapability,
  387  ): QOperatingMode {
  388    switch (capability) {
  389      case "CLASSIFY":
  390        return "ASSESSMENT";
  391      case "ANSWER":
  392      case "INVESTIGATE":
  393      case "ASSESS":
  394      case "COMPARE":
  395      case "PREPARE_ACTION":
  396        return "DEBRIEF";
  397    }
  398  }
  399
  400  /** V1 per-task budgets (doc 12 §49). Data-shaped; a later packet may load them. */
  401  export function budgetForTaskClass(taskClass: ModelTextTaskClass): ModelBudget {
  402    switch (taskClass) {
  403      case "FAST_CLASSIFICATION":
  404      case "TAXONOMY_MAPPING":
  405        return {
  406          maxAttempts: 3,
  407          maxEstimatedCostUsd: 0.02,
  408          maxOutputTokens: 1_024,
  409          attemptTimeoutMs: 20_000,
  410        };
  411      case "STRUCTURED_EXTRACTION":
  412        return {
  413          maxAttempts: 3,
  414          maxEstimatedCostUsd: 0.05,
  415          // The largest structured output Capital Q asks for: a founder
  416          // extraction returns candidates with their supporting quotes,
  417          // taxonomy phrases, conflicts, ambiguities, gaps and proposed
  418          // questions in one object. At 2,048 the answer was truncated
  419          // mid-JSON and rejected as invalid output — a budget too small to
  420          // finish the work is a budget that spends the whole call for
  421          // nothing (CQ-C5-R2B §37).
  422          maxOutputTokens: 6_144,
  423          attemptTimeoutMs: 30_000,
  424        };
  425      case "NORMAL_DIALOGUE":
  426        return {
  427          maxAttempts: 3,
  428          maxEstimatedCostUsd: 0.1,
  429          maxOutputTokens: 4_096,
  430          attemptTimeoutMs: 45_000,
  431        };
  432      case "EVIDENCE_SYNTHESIS":
  433      case "COMPARISON":
  434        return {
  435          maxAttempts: 3,
  436          maxEstimatedCostUsd: 0.5,
  437          // "Break what you just told me into actionable steps" is an
  438          // ordinary request and a long answer, and the whole answer travels
  439          // inside one JSON object. At 3,072 the ledger showed answers
  440          // stopping at exactly the ceiling: the object never closed, so the
  441          // parse failed, so every fallback model repeated it and the person
  442          // was told the review could not be completed. Cost is still bounded
  443          // by maxEstimatedCostUsd; only the room to finish a sentence is not.
  444          maxOutputTokens: 8_192,
  445          attemptTimeoutMs: 60_000,
  446        };
  447      case "DEEP_INVESTIGATION":
  448        return {
  449          maxAttempts: 3,
  450          maxEstimatedCostUsd: 1.0,
  451          maxOutputTokens: 4_096,
  452          attemptTimeoutMs: 90_000,
  453        };
  454    }
  455  }
  456
```

## `packages/model-gateway/src/q/turn-reader.ts` lines 100-130

```ts
  100  };
  101
  102  /**
  103   * Small and fast: a classification in front of an answer the person is
  104   * waiting for. Two attempts so a single failing provider can fall back.
  105   * The output room is for a reasoning model's thinking as much as for the
  106   * JSON: at 300 tokens gpt-oss spent it all thinking and returned nothing,
  107   * which the provider refused as invalid JSON (local, 2026-09-24).
  108   */
  109  const TURN_READER_BUDGET = {
  110    maxAttempts: 2,
  111    maxEstimatedCostUsd: 0.01,
  112    maxOutputTokens: 1_200,
  113    attemptTimeoutMs: 6_000,
  114  } as const;
  115
  116  /**
  117   * How long the first model gets when a synthetic-demo posture routes the
  118   * read to the fast shared model first and another waits behind it. Measured
  119   * 2026-10-01 (ai_ops.model_usage, 72 h, Gemini flash-lite): 66 reads
  120   * answered, p90 1.4 s, p99 3.2 s, only 4 over 2.5 s; 8 hung to the 6 s
  121   * deadline, each a 6 s stall before the fallback read the turn. At 2.5 s a
  122   * hung read costs 2.5 s and the fallback keeps its full 6 s. Not applied to
  123   * other postures, where the first model is the slower one (p50 ~2 s).
  124   */
  125  export const TURN_READER_FAST_FIRST_ATTEMPT_MS = 2_500;
  126
  127  /**
  128   * The reader's action list budget (HARDEN, 2026-10-02: the app-action
  129   * registry grows toward 60-80 entries). Offered actions are listed first
  130   * and never cut below this; declared-but-not-offered ones fill what is
```

## `packages/model-gateway/src/q/turn-reader.ts` lines 286-312

```ts
  286            communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
  287            environmentNotes:
  288              "You classify one turn and nothing else; Capital Q decides what follows from it.",
  289            variables,
  290          });
  291          const response = await gateway.execute<TurnReaderV44Result>(
  292            {
  293              taskClass: "FAST_CLASSIFICATION",
  294              // A closed classification needs little thought; left unset, a
  295              // reasoning model thinks at length before a one-line answer.
  296              reasoning: "LOW",
  297              sensitivity,
  298              ...(dependencies.dataPosture === undefined
  299                ? {}
  300                : { dataPosture: dependencies.dataPosture }),
  301              budget: TURN_READER_BUDGET,
  302              messages: [...rendered.messages],
  303              output: rendered.output,
  304              attribution: input.attribution,
  305            },
  306            {
  307              schema: TurnReaderV44ResultSchema,
  308              ...(input.signal === undefined ? {} : { signal: input.signal }),
  309              ...(dependencies.dataPosture === "SYNTHETIC_DEMO"
  310                ? { firstAttemptTimeoutMs: TURN_READER_FAST_FIRST_ATTEMPT_MS }
  311                : {}),
  312            },
```

## `packages/model-gateway/src/policy/cost.ts` lines 18-89

```ts
   18  /**
   19   * A deliberately conservative pre-call estimate: roughly four characters
   20   * per token for prose, rounded up. Used to reject routes that are
   21   * obviously outside a window or a budget, never as accounting.
   22   */
   23  export function estimateInputTokens(
   24    messages: readonly ModelMessage[],
   25    tools: readonly ModelToolDefinition[] = [],
   26  ): number {
   27    let chars = 0;
   28    for (const message of messages) {
   29      chars += message.content.length + 8;
   30      // A low-detail image is about a thousand tokens on every provider.
   31      if (message.role === "USER" && message.images !== undefined) {
   32        chars += message.images.length * 4_000;
   33      }
   34      if (message.role === "ASSISTANT" && message.toolCalls !== undefined) {
   35        chars += JSON.stringify(message.toolCalls).length;
   36      }
   37    }
   38    for (const tool of tools) {
   39      chars +=
   40        tool.name.length +
   41        tool.description.length +
   42        JSON.stringify(tool.inputJsonSchema).length +
   43        16;
   44    }
   45    return Math.ceil(chars / 4);
   46  }
   47
   48  const USD_PRECISION = 1e8;
   49
   50  function roundUsd(amount: number): number {
   51    return Math.round(amount * USD_PRECISION) / USD_PRECISION;
   52  }
   53
   54  export function priceUsage(
   55    usage: ModelUsage,
   56    price: ModelPriceRecord | null,
   57    basis: "PRICE_SNAPSHOT" | "ESTIMATED",
   58  ): ModelCost {
   59    if (price === null) {
   60      return { currency: "USD", amount: 0, basis: "UNPRICED" };
   61    }
   62    const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
   63    const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
   64    const outputTokens = usage.outputTokens + (usage.reasoningTokens ?? 0);
   65    const amount =
   66      (uncached * price.inputPerMillion +
   67        usage.cachedInputTokens * cachedRate +
   68        outputTokens * price.outputPerMillion) /
   69      1_000_000;
   70    return {
   71      currency: "USD",
   72      amount: roundUsd(amount),
   73      basis,
   74      priceSnapshotId: price.id,
   75    };
   76  }
   77
   78  /** The upper bound a single attempt could cost: full output budget spent. */
   79  export function estimateAttemptCost(
   80    inputTokens: number,
   81    maxOutputTokens: number,
   82    price: ModelPriceRecord | null,
   83  ): ModelCost {
   84    return priceUsage(
   85      { inputTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens },
   86      price,
   87      "ESTIMATED",
   88    );
   89  }
```

## `packages/model-gateway/src/infrastructure/postgres-usage.ts` lines 1-33

```ts
    1  import type { DatabaseExecutor } from "@capital-q/database";
    2
    3  import type { ModelUsageEntry, ModelUsageRepository } from "../ports.js";
    4
    5  /**
    6   * The append-only usage ledger (doc 13 §56.5; packet §41-42). One row per
    7   * real provider attempt, success or failure, with tokens, latency, cost
    8   * and the failure class. Nothing about what was said.
    9   *
   10   * Writes are autonomous (their own statement, never the caller's
   11   * transaction): a run that later fails must still have paid for what it
   12   * used, and a ledger row must never be rolled back with a domain write.
   13   */
   14  export function createPostgresModelUsageRepository(options: {
   15    readonly sql: DatabaseExecutor;
   16  }): ModelUsageRepository {
   17    return {
   18      record: async (entry: ModelUsageEntry) => {
   19        await options.sql`
   20          insert into ai_ops.model_usage
   21            (tenant_id, user_id, q_run_id, task_class, provider_id, model_id, routing_policy_id, attempt,
   22             input_tokens, cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis,
   23             success, error_code, correlation_id, purpose)
   24          values
   25            (${entry.tenantId}, ${entry.userId ?? null}, ${entry.qRunId ?? null}, ${entry.taskClass},
   26             ${entry.providerId}, ${entry.modelId}, ${entry.routingPolicyId ?? null}, ${entry.attempt},
   27             ${entry.inputTokens}, ${entry.cachedInputTokens}, ${entry.outputTokens}, ${entry.latencyMs},
   28             ${entry.costUsd === undefined ? null : entry.costUsd.toFixed(8)}::text::numeric, ${entry.costBasis},
   29             ${entry.success}, ${entry.errorCode ?? null}, ${entry.correlationId ?? null},
   30             ${entry.purpose ?? "OTHER"})`;
   31      },
   32    };
   33  }
```
