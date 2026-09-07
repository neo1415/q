import type { z } from "zod";

import {
  allowsModelFallback,
  isRetryableModelFailure,
  ModelGatewayRequestSchema,
  ModelGatewayResultMetadataSchema,
  type ModelAttemptRecord,
  type ModelCandidateDecision,
  type ModelCost,
  type ModelFailureClass,
  type ModelGatewayRequest,
  type ModelGatewayRequestInput,
  type ModelGatewayResult,
  type ModelUsage,
} from "@capital-q/contracts";
import { getMeter, getTracer, type Logger } from "@capital-q/observability";

import { indexCatalog, type ModelCatalog } from "./catalog.js";
import { ModelGatewayError, ModelProviderFailure } from "./errors.js";
import {
  noTenantModelPolicy,
  requiredCapabilitiesFor,
  systemModelClock,
  type ModelCatalogPort,
  type ModelClock,
  type ModelProvider,
  type ModelProviderRegistry,
  type ModelUsageRepository,
  type ProviderHealthPort,
  type TenantModelPolicyPort,
} from "./ports.js";
import { estimateInputTokens, priceUsage } from "./policy/cost.js";
import {
  planRoute,
  selectRoutingPolicy,
  type EligibleCandidate,
} from "./policy/eligibility.js";
import { alwaysHealthy } from "./policy/health.js";
import { acceptStructuredOutput } from "./policy/structured.js";

/**
 * The Model Gateway (doc 12 §24; packet §8).
 *
 * One entry point, `execute`, that owns everything between "Q needs model
 * work" and "here is a validated result": policy lookup, eligibility,
 * ordering, budget, timeouts, cancellation, bounded retry, bounded
 * fallback, structured-output acceptance, cost, the usage ledger and
 * telemetry. It owns none of the meaning — no prompt, no Q behaviour, no
 * retrieval, no tool, no approval — and it never chooses with a model.
 *
 * Invariants proven by the unit suite:
 *   - eligibility (privacy first) is decided before any provider is called;
 *   - a fallback is judged by the same rules as the first choice;
 *   - retries and fallbacks are bounded by the request budget;
 *   - a cancelled request never falls back;
 *   - provider JSON is accepted only through the caller's schema;
 *   - a tool call naming a tool the request did not offer is invalid output;
 *   - a provider's error text never leaves as anything but a class.
 */

export type ModelGatewayDependencies = {
  readonly catalog: ModelCatalogPort;
  readonly registry: ModelProviderRegistry;
  readonly usage: ModelUsageRepository;
  readonly health?: ProviderHealthPort | undefined;
  readonly tenantPolicies?: TenantModelPolicyPort | undefined;
  readonly clock?: ModelClock | undefined;
  readonly logger?: Logger | undefined;
  /** Injectable for deterministic tests; production waits for real. */
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
};

export type ModelGatewayExecuteOptions<T> = {
  /** Required for STRUCTURED output: the schema that decides acceptance. */
  readonly schema?: z.ZodType<T> | undefined;
  /** The caller's cancellation. A cancelled request never falls back. */
  readonly signal?: AbortSignal | undefined;
};

export type ModelGateway = {
  readonly execute: <T = never>(
    request: ModelGatewayRequestInput,
    options?: ModelGatewayExecuteOptions<T>,
  ) => Promise<ModelGatewayResult<T>>;
};

/** At most one retry on the same candidate before moving on. */
const ATTEMPTS_PER_CANDIDATE = 2;
const BACKOFF_BASE_MS = 300;
const BACKOFF_CAP_MS = 4_000;
const RETRY_AFTER_CAP_MS = 10_000;

type AttemptOutcome<T> =
  | {
      readonly kind: "SUCCESS";
      readonly result: ModelGatewayResult<T>;
    }
  | {
      readonly kind: "FAILURE";
      readonly failureClass: ModelFailureClass;
      readonly retryAfterMs: number | undefined;
      readonly cause: unknown;
    };

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function estimatedUsage(inputTokens: number, text: string): ModelUsage {
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: Math.ceil(text.length / 4),
  };
}

export function createModelGateway(
  dependencies: ModelGatewayDependencies,
): ModelGateway {
  const health = dependencies.health ?? alwaysHealthy;
  const tenantPolicies = dependencies.tenantPolicies ?? noTenantModelPolicy;
  const clock = dependencies.clock ?? systemModelClock;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const logger = dependencies.logger;
  const tracer = getTracer("@capital-q/model-gateway");
  const meter = getMeter("@capital-q/model-gateway");
  const metrics = {
    requests: meter.createCounter("q.model.requests"),
    successes: meter.createCounter("q.model.successes"),
    failures: meter.createCounter("q.model.failures"),
    attempts: meter.createCounter("q.model.attempts"),
    fallbacks: meter.createCounter("q.model.fallbacks"),
    rateLimits: meter.createCounter("q.model.rate_limits"),
    policyIneligible: meter.createCounter("q.model.policy_ineligible"),
    budgetRejected: meter.createCounter("q.model.budget_rejected"),
    usageRecordFailures: meter.createCounter("q.model.usage_record_failures"),
    latencyMs: meter.createHistogram("q.model.provider_latency_ms"),
    tokensIn: meter.createHistogram("q.model.tokens_in"),
    tokensOut: meter.createHistogram("q.model.tokens_out"),
    costUsd: meter.createHistogram("q.model.estimated_cost_usd"),
  };

  function backoffMs(
    attemptOnCandidate: number,
    retryAfterMs: number | undefined,
  ): number {
    const exponential = Math.min(
      BACKOFF_BASE_MS * 2 ** (attemptOnCandidate - 1),
      BACKOFF_CAP_MS,
    );
    const jittered = Math.round(exponential * (0.75 + random() * 0.5));
    if (retryAfterMs !== undefined) {
      return Math.min(Math.max(jittered, retryAfterMs), RETRY_AFTER_CAP_MS);
    }
    return jittered;
  }

  async function recordUsage(
    entry: Parameters<ModelUsageRepository["record"]>[0],
  ): Promise<void> {
    try {
      await dependencies.usage.record(entry);
    } catch (error: unknown) {
      // Accounting must not fail the answer, but it must never be silent.
      metrics.usageRecordFailures.add(1);
      logger?.error(
        { err: error, qRunId: entry.qRunId, taskClass: entry.taskClass },
        "model usage ledger write failed",
      );
    }
  }

  async function attempt<T>(
    request: ModelGatewayRequest,
    candidate: EligibleCandidate,
    provider: ModelProvider,
    policyId: string,
    attemptNumber: number,
    schema: z.ZodType<T> | undefined,
    callerSignal: AbortSignal,
  ): Promise<AttemptOutcome<T> & { readonly record: ModelAttemptRecord }> {
    const labels = {
      provider: candidate.provider.code,
      model: candidate.model.modelCode,
      task_class: request.taskClass,
    };
    return tracer.startActiveSpan(
      "q.model_gateway.provider_attempt",
      {
        attributes: {
          ...labels,
          "q.model.attempt": attemptNumber,
          "q.model.candidate_index": candidate.candidateIndex,
          "q.run_id": request.attribution.qRunId ?? "",
        },
      },
      async (span) => {
        const startedAt = Date.now();
        const timeoutSignal = AbortSignal.timeout(
          request.budget.attemptTimeoutMs,
        );
        const signal = AbortSignal.any([callerSignal, timeoutSignal]);
        const outputTokens = Math.min(
          request.budget.maxOutputTokens,
          candidate.model.maxOutputTokens,
        );
        let outcome: AttemptOutcome<T>;
        let usage: ModelUsage | undefined;
        let cost: ModelCost | undefined;
        try {
          const result = await provider.generate(
            {
              modelCode: candidate.model.modelCode,
              messages: request.messages,
              output: request.output,
              tools: request.tools,
              maxOutputTokens: outputTokens,
              temperature: request.temperature,
              reasoning: request.reasoning,
            },
            {
              signal,
              attemptTimeoutMs: request.budget.attemptTimeoutMs,
              attempt: attemptNumber,
              correlationId: request.attribution.correlationId,
            },
          );
          const latencyMs = Date.now() - startedAt;
          const basis =
            result.usage === undefined ? "ESTIMATED" : "PRICE_SNAPSHOT";
          usage =
            result.usage ??
            estimatedUsage(candidate.estimatedInputTokens, result.text);
          cost = priceUsage(usage, candidate.price, basis);

          const proposedCalls = result.toolCalls ?? [];
          if (proposedCalls.length > 0) {
            // A proposal is accepted only for a tool this request offered.
            // The registry validates arguments and authorises; the gateway
            // only refuses what could never have been offered.
            const offered = new Set(request.tools.map((tool) => tool.name));
            const unoffered = proposedCalls.some(
              (call) => !offered.has(call.name),
            );
            if (request.tools.length === 0 || unoffered) {
              outcome = {
                kind: "FAILURE",
                failureClass: "INVALID_MODEL_OUTPUT",
                retryAfterMs: undefined,
                cause: undefined,
              };
              span.setAttribute("q.model.invalid_output_stage", "TOOL");
            } else {
              outcome = {
                kind: "SUCCESS",
                result: buildResult(
                  request,
                  candidate,
                  result.modelCode,
                  usage,
                  latencyMs,
                  "TOOL_CALLS",
                  cost,
                  result.providerReference,
                  {
                    kind: "TOOL_CALLS",
                    calls: proposedCalls,
                    text: result.text,
                  },
                ),
              };
              span.setAttribute("q.model.tool_calls", proposedCalls.length);
            }
          } else if (request.output.kind === "STRUCTURED") {
            if (schema === undefined) {
              throw new ModelProviderFailure(
                "structured output requested without a schema",
                {
                  failureClass: "INVALID_REQUEST",
                  providerCode: provider.code,
                },
              );
            }
            const accepted = acceptStructuredOutput(result.text, schema);
            if (!accepted.ok) {
              outcome = {
                kind: "FAILURE",
                failureClass: "INVALID_MODEL_OUTPUT",
                retryAfterMs: undefined,
                cause: undefined,
              };
              span.setAttribute("q.model.invalid_output_stage", accepted.stage);
            } else {
              outcome = {
                kind: "SUCCESS",
                result: buildResult(
                  request,
                  candidate,
                  result.modelCode,
                  usage,
                  latencyMs,
                  result.finish,
                  cost,
                  result.providerReference,
                  { kind: "STRUCTURED", value: accepted.value },
                ),
              };
            }
          } else {
            outcome = {
              kind: "SUCCESS",
              result: buildResult(
                request,
                candidate,
                result.modelCode,
                usage,
                latencyMs,
                result.finish,
                cost,
                result.providerReference,
                { kind: "TEXT", text: result.text },
              ),
            };
          }
        } catch (error: unknown) {
          outcome = classifyFailure(
            error,
            callerSignal,
            timeoutSignal,
            provider.code,
          );
        }
        const latencyMs = Date.now() - startedAt;

        // The ledger row: tokens and cost when known, the class otherwise.
        const failureClass =
          outcome.kind === "SUCCESS" ? undefined : outcome.failureClass;
        const success = failureClass === undefined;
        await recordUsage({
          tenantId: request.attribution.tenantId,
          userId: request.attribution.userId,
          qRunId: request.attribution.qRunId,
          taskClass: request.taskClass,
          providerId: candidate.provider.id,
          modelId: candidate.model.id,
          routingPolicyId: policyId,
          attempt: attemptNumber,
          inputTokens: usage?.inputTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          latencyMs,
          costUsd: cost?.amount,
          costBasis: cost?.basis ?? "UNPRICED",
          success,
          errorCode: failureClass,
          correlationId: request.attribution.correlationId,
        });

        const result = failureClass ?? "success";
        metrics.attempts.add(1, { ...labels, result });
        metrics.latencyMs.record(latencyMs, labels);
        if (usage !== undefined) {
          metrics.tokensIn.record(usage.inputTokens, labels);
          metrics.tokensOut.record(usage.outputTokens, labels);
        }
        if (cost !== undefined) {
          metrics.costUsd.record(cost.amount, labels);
        }
        if (failureClass === "RATE_LIMIT") {
          metrics.rateLimits.add(1, labels);
        }
        if (failureClass === undefined) {
          health.recordSuccess(provider.code, clock.now());
        } else {
          health.recordFailure(provider.code, failureClass, clock.now());
        }
        span.setAttribute("q.model.result", result);
        span.setAttribute("q.model.latency_ms", latencyMs);
        if (outcome.kind === "FAILURE" && outcome.cause !== undefined) {
          // Private diagnostics: the class and the provider's status only.
          logger?.warn(
            {
              ...labels,
              qRunId: request.attribution.qRunId,
              attempt: attemptNumber,
              failureClass: outcome.failureClass,
              providerStatus:
                outcome.cause instanceof ModelProviderFailure
                  ? outcome.cause.providerStatus
                  : undefined,
              vendorErrorCode:
                outcome.cause instanceof ModelProviderFailure
                  ? outcome.cause.vendorErrorCode
                  : undefined,
            },
            "model provider attempt failed",
          );
        }
        span.end();

        const record: ModelAttemptRecord = {
          attempt: attemptNumber,
          providerCode: candidate.provider.code,
          modelCode: candidate.model.modelCode,
          outcome: failureClass ?? "SUCCESS",
          latencyMs,
          ...(usage === undefined ? {} : { usage }),
          ...(cost === undefined ? {} : { cost }),
          candidateIndex: candidate.candidateIndex,
        };
        return { ...outcome, record };
      },
    );
  }

  async function execute<T>(
    input: ModelGatewayRequestInput,
    options: ModelGatewayExecuteOptions<T> = {},
  ): Promise<ModelGatewayResult<T>> {
    const parsed = ModelGatewayRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ModelGatewayError("model gateway request is invalid", {
        failureClass: "INVALID_REQUEST",
        attempts: 0,
        candidates: [],
      });
    }
    const request = parsed.data;
    if (request.output.kind === "STRUCTURED" && options.schema === undefined) {
      throw new ModelGatewayError(
        "structured output requires a validation schema",
        {
          failureClass: "INVALID_REQUEST",
          attempts: 0,
          candidates: [],
        },
      );
    }
    const callerSignal = options.signal ?? new AbortController().signal;
    metrics.requests.add(1, { task_class: request.taskClass });

    return tracer.startActiveSpan(
      "q.model_gateway.execute",
      {
        attributes: {
          "q.model.task_class": request.taskClass,
          "q.model.sensitivity": request.sensitivity,
          "q.run_id": request.attribution.qRunId ?? "",
          "q.tenant_id": request.attribution.tenantId,
        },
      },
      async (span) => {
        try {
          return await route(request, options.schema, callerSignal, span);
        } finally {
          span.end();
        }
      },
    );
  }

  async function route<T>(
    request: ModelGatewayRequest,
    schema: z.ZodType<T> | undefined,
    callerSignal: AbortSignal,
    span: {
      setAttribute: (key: string, value: string | number | boolean) => unknown;
    },
  ): Promise<ModelGatewayResult<T>> {
    if (callerSignal.aborted) {
      throw new ModelGatewayError("model request cancelled before routing", {
        failureClass: "CANCELLED",
        attempts: 0,
        candidates: [],
      });
    }
    const now = clock.now();
    const catalog: ModelCatalog = indexCatalog(
      await dependencies.catalog.load(),
    );
    const policy = selectRoutingPolicy(catalog, request);
    if (policy === null) {
      metrics.policyIneligible.add(1, {
        task_class: request.taskClass,
        reason: "NO_POLICY",
      });
      throw new ModelGatewayError("no active routing policy covers this task", {
        failureClass: "POLICY_INELIGIBLE",
        attempts: 0,
        candidates: [],
      });
    }
    span.setAttribute("q.model.routing_policy", policy.code);
    const tenantPolicy =
      request.tenantPolicy ??
      (await tenantPolicies.policyFor(request.attribution.tenantId));
    const plan = planRoute(
      {
        catalog,
        registry: dependencies.registry,
        health,
        request,
        requiredCapabilities: requiredCapabilitiesFor(
          request.output,
          request.requiredCapabilities,
          request.tools,
        ),
        estimatedInputTokens: estimateInputTokens(
          request.messages,
          request.tools,
        ),
        tenantPolicy,
        now,
      },
      policy,
    );

    if (plan.eligible.length === 0) {
      const onlyCost = plan.decisions.every(
        (d) =>
          d.reason === "COST_EXCEEDS_CEILING" || d.reason === "PRICE_UNKNOWN",
      );
      const failureClass = onlyCost ? "BUDGET_EXCEEDED" : "POLICY_INELIGIBLE";
      if (onlyCost) {
        metrics.budgetRejected.add(1, { task_class: request.taskClass });
      } else {
        metrics.policyIneligible.add(1, {
          task_class: request.taskClass,
          reason: plan.decisions[0]?.reason ?? "NONE",
        });
      }
      logger?.info(
        {
          taskClass: request.taskClass,
          sensitivity: request.sensitivity,
          routingPolicy: policy.code,
          decisions: plan.decisions.map(
            (d) => `${d.providerCode}/${d.modelCode}:${d.reason}`,
          ),
          qRunId: request.attribution.qRunId,
        },
        "model request has no eligible route",
      );
      throw new ModelGatewayError(
        "no configured model is eligible for this request",
        {
          failureClass,
          attempts: 0,
          candidates: plan.decisions,
          routingPolicyCode: policy.code,
        },
      );
    }

    const attempts: ModelAttemptRecord[] = [];
    let spentUsd = 0;
    let lastFailure: ModelFailureClass | undefined;
    let lastCause: unknown;
    let attemptNumber = 0;

    for (const candidate of plan.eligible) {
      const provider = dependencies.registry.get(candidate.provider.code);
      if (provider === undefined) {
        continue;
      }
      if (
        candidate.candidateIndex > (plan.eligible[0]?.candidateIndex ?? 0) &&
        attempts.length > 0
      ) {
        metrics.fallbacks.add(1, {
          task_class: request.taskClass,
          provider: candidate.provider.code,
        });
      }
      let attemptsOnCandidate = 0;
      while (attemptsOnCandidate < ATTEMPTS_PER_CANDIDATE) {
        if (attemptNumber >= request.budget.maxAttempts) {
          break;
        }
        if (callerSignal.aborted) {
          throw new ModelGatewayError("model request cancelled", {
            failureClass: "CANCELLED",
            attempts: attempts.length,
            candidates: plan.decisions,
            routingPolicyCode: policy.code,
          });
        }
        // Retries and fallbacks count toward the same money.
        if (
          spentUsd + candidate.estimatedAttemptCostUsd >
          request.budget.maxEstimatedCostUsd
        ) {
          lastFailure = "BUDGET_EXCEEDED";
          metrics.budgetRejected.add(1, { task_class: request.taskClass });
          break;
        }
        attemptNumber += 1;
        attemptsOnCandidate += 1;
        const outcome = await attempt(
          request,
          candidate,
          provider,
          policy.id,
          attemptNumber,
          schema,
          callerSignal,
        );
        attempts.push(outcome.record);
        spentUsd +=
          outcome.record.cost?.amount ?? candidate.estimatedAttemptCostUsd;

        if (outcome.kind === "SUCCESS") {
          metrics.successes.add(1, {
            task_class: request.taskClass,
            provider: candidate.provider.code,
            model: candidate.model.modelCode,
          });
          const fallbackUsed =
            candidate.candidateIndex !== plan.eligible[0]?.candidateIndex;
          const result: ModelGatewayResult<T> = {
            ...outcome.result,
            routingPolicyCode: policy.code,
            attempts: [...attempts],
            fallbackUsed,
            route: {
              routingPolicyCode: policy.code,
              routingPolicyVersion: policy.version,
              candidates: [...plan.decisions],
              selectedCandidateIndex: candidate.candidateIndex,
              fallbackUsed,
            },
          };
          ModelGatewayResultMetadataSchema.parse(stripOutput(result));
          logger?.info(
            {
              taskClass: request.taskClass,
              provider: candidate.provider.code,
              model: candidate.model.modelCode,
              routingPolicy: policy.code,
              attempts: attempts.length,
              fallbackUsed,
              latencyMs: result.latencyMs,
              costUsd: result.cost.amount,
              costBasis: result.cost.basis,
              qRunId: request.attribution.qRunId,
            },
            "model request served",
          );
          return result;
        }

        lastFailure = outcome.failureClass;
        lastCause = outcome.cause;
        if (outcome.failureClass === "CANCELLED") {
          // The person stopped it. No retry, no fallback, no second answer.
          throw new ModelGatewayError("model request cancelled", {
            failureClass: "CANCELLED",
            attempts: attempts.length,
            candidates: plan.decisions,
            routingPolicyCode: policy.code,
            cause: lastCause,
          });
        }
        const canRetryHere =
          isRetryableModelFailure(outcome.failureClass) &&
          attemptsOnCandidate < ATTEMPTS_PER_CANDIDATE &&
          attemptNumber < request.budget.maxAttempts;
        if (canRetryHere) {
          try {
            await sleep(
              backoffMs(attemptsOnCandidate, outcome.retryAfterMs),
              callerSignal,
            );
          } catch {
            throw new ModelGatewayError("model request cancelled", {
              failureClass: "CANCELLED",
              attempts: attempts.length,
              candidates: plan.decisions,
              routingPolicyCode: policy.code,
            });
          }
          continue;
        }
        if (!allowsModelFallback(outcome.failureClass)) {
          throw new ModelGatewayError("model request failed", {
            failureClass: outcome.failureClass,
            attempts: attempts.length,
            candidates: plan.decisions,
            routingPolicyCode: policy.code,
            cause: lastCause,
          });
        }
        break; // next eligible candidate, judged by the same rules already
      }
      if (attemptNumber >= request.budget.maxAttempts) {
        break;
      }
    }

    const failureClass: ModelFailureClass =
      lastFailure ??
      (attempts.length === 0 ? "BUDGET_EXCEEDED" : "PROVIDER_OUTAGE");
    metrics.failures.add(1, {
      task_class: request.taskClass,
      failure_class: failureClass,
    });
    throw new ModelGatewayError("model request failed after bounded attempts", {
      failureClass,
      attempts: attempts.length,
      candidates: plan.decisions,
      routingPolicyCode: policy.code,
      cause: lastCause,
    });
  }

  return { execute };
}

function stripOutput<T>(
  result: ModelGatewayResult<T>,
): Omit<ModelGatewayResult<T>, "output"> {
  const { output: _output, ...metadata } = result;
  return metadata;
}

function buildResult<T>(
  request: ModelGatewayRequest,
  candidate: EligibleCandidate,
  modelCode: string,
  usage: ModelUsage,
  latencyMs: number,
  finish: ModelGatewayResult<T>["finish"],
  cost: ModelCost,
  providerReference: string | undefined,
  output: ModelGatewayResult<T>["output"],
): ModelGatewayResult<T> {
  return {
    providerCode: candidate.provider.code,
    modelCode: modelCode || candidate.model.modelCode,
    taskClass: request.taskClass,
    routingPolicyCode: "placeholder.v1",
    usage,
    latencyMs,
    finish,
    cost,
    attempts: [],
    fallbackUsed: false,
    ...(providerReference === undefined ? {} : { providerReference }),
    route: {
      routingPolicyCode: "placeholder.v1",
      routingPolicyVersion: 1,
      candidates: [],
      selectedCandidateIndex: candidate.candidateIndex,
      fallbackUsed: false,
    },
    completedAt: new Date().toISOString(),
    output,
  };
}

/**
 * Turn whatever an adapter threw into a class. An adapter's own
 * ModelProviderFailure is trusted; anything else is PERMANENT with its
 * text kept only on the cause. The caller's signal decides between
 * CANCELLED and TIMEOUT when the attempt was aborted.
 */
function classifyFailure<T>(
  error: unknown,
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  providerCode: string,
): AttemptOutcome<T> {
  if (callerSignal.aborted) {
    return {
      kind: "FAILURE",
      failureClass: "CANCELLED",
      retryAfterMs: undefined,
      cause: error,
    };
  }
  if (error instanceof ModelProviderFailure) {
    const failureClass =
      error.failureClass === "CANCELLED" && timeoutSignal.aborted
        ? "TIMEOUT"
        : error.failureClass;
    return {
      kind: "FAILURE",
      failureClass,
      retryAfterMs: error.retryAfterMs,
      cause: error,
    };
  }
  if (timeoutSignal.aborted) {
    return {
      kind: "FAILURE",
      failureClass: "TIMEOUT",
      retryAfterMs: undefined,
      cause: error,
    };
  }
  return {
    kind: "FAILURE",
    failureClass: "PERMANENT",
    retryAfterMs: undefined,
    cause: new ModelProviderFailure(
      "provider adapter threw an unclassified error",
      {
        failureClass: "PERMANENT",
        providerCode,
        cause: error,
      },
    ),
  };
}

export type { ModelCandidateDecision };
