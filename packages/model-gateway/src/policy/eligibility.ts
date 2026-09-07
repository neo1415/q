import {
  MODEL_LATENCY_RANK,
  MODEL_QUALITY_RANK,
  sensitivityAtMost,
  type ModelCandidateDecision,
  type ModelCapability,
  type ModelEligibilityReason,
  type ModelGatewayRequest,
  type ModelLatencyClass,
  type ModelQualityClass,
  type TenantModelPolicy,
} from "@capital-q/contracts";

import {
  effectivePrice,
  isModelEffective,
  type ModelCatalog,
  type ModelPriceRecord,
  type ModelRecord,
  type ProviderRecord,
  type RoutingPolicyRecord,
} from "../catalog.js";
import type { ModelProviderRegistry, ProviderHealthPort } from "../ports.js";
import { estimateAttemptCost } from "./cost.js";

/**
 * Eligibility and candidate ordering (doc 12 §24.4; doc 13 §120; doc 15
 * §61-62; packet §10, §21, §24, §38).
 *
 * Deterministic and data-driven: a routing policy names the candidates in
 * order of preference, and every candidate is judged in the same fixed
 * sequence — provider status, adapter presence, health, model status and
 * period, SENSITIVITY CEILING, tenant policy, capabilities, context window,
 * output limit, quality floor, latency target, and only then cost. The
 * first reason to refuse is the reason recorded. Privacy is decided
 * before price is looked at, and the same judgement applies to a
 * fallback as to a first choice, so availability can never widen what a
 * request may reach.
 */

export type EligibleCandidate = {
  readonly candidateIndex: number;
  readonly provider: ProviderRecord;
  readonly model: ModelRecord;
  readonly price: ModelPriceRecord | null;
  readonly estimatedInputTokens: number;
  readonly estimatedAttemptCostUsd: number;
};

export type RoutePlan = {
  readonly policy: RoutingPolicyRecord;
  readonly decisions: readonly ModelCandidateDecision[];
  readonly eligible: readonly EligibleCandidate[];
};

/**
 * The active policy for a task class whose sensitivity class covers the
 * request: the most specific (lowest) covering ceiling, highest version.
 */
export function selectRoutingPolicy(
  catalog: ModelCatalog,
  request: Pick<ModelGatewayRequest, "taskClass" | "sensitivity">,
): RoutingPolicyRecord | null {
  const policies = (catalog.policiesByTaskClass.get(request.taskClass) ?? [])
    .filter(
      (policy) =>
        policy.status === "ACTIVE" &&
        sensitivityAtMost(request.sensitivity, policy.sensitivityClass),
    )
    .sort((a, b) => {
      const byCeiling =
        rankSensitivity(a.sensitivityClass) -
        rankSensitivity(b.sensitivityClass);
      return byCeiling !== 0 ? byCeiling : b.version - a.version;
    });
  return policies[0] ?? null;
}

function rankSensitivity(
  sensitivity: RoutingPolicyRecord["sensitivityClass"],
): number {
  return [
    "PUBLIC",
    "NETWORK_VISIBLE",
    "INTERNAL",
    "CONFIDENTIAL",
    "HIGHLY_CONFIDENTIAL",
    "RESTRICTED",
  ].indexOf(sensitivity);
}

function modelCapabilities(model: ModelRecord): ReadonlySet<ModelCapability> {
  const set = new Set<ModelCapability>();
  if (model.modelType === "TEXT_GENERATION") {
    set.add("TEXT_GENERATION");
  }
  if (model.modelType === "EMBEDDING") {
    set.add("EMBEDDING");
  }
  if (model.supportsStructuredOutput) set.add("STRUCTURED_OUTPUT");
  if (model.supportsTools) set.add("TOOL_CALLING");
  if (model.supportsVision) {
    set.add("VISION");
    set.add("DOCUMENT_INPUT");
  }
  if (model.supportsAudio) set.add("AUDIO_INPUT");
  if (model.supportsRealtime) set.add("REALTIME");
  if (model.supportsPromptCache) set.add("PROMPT_CACHE");
  if (model.supportsReasoning) set.add("REASONING");
  return set;
}

function meetsQuality(model: ModelRecord, floor: ModelQualityClass): boolean {
  return MODEL_QUALITY_RANK[model.qualityClass] >= MODEL_QUALITY_RANK[floor];
}

function meetsLatency(model: ModelRecord, target: ModelLatencyClass): boolean {
  return MODEL_LATENCY_RANK[model.latencyClass] <= MODEL_LATENCY_RANK[target];
}

function tenantAllows(
  policy: TenantModelPolicy | undefined,
  providerCode: string,
): boolean {
  if (policy === undefined) {
    return true;
  }
  if (policy.deniedProviderCodes.includes(providerCode)) {
    return false;
  }
  if (
    policy.allowedProviderCodes !== undefined &&
    !policy.allowedProviderCodes.includes(providerCode)
  ) {
    return false;
  }
  return true;
}

export type EligibilityInput = {
  readonly catalog: ModelCatalog;
  readonly registry: ModelProviderRegistry;
  readonly health: ProviderHealthPort;
  readonly request: ModelGatewayRequest;
  readonly requiredCapabilities: readonly ModelCapability[];
  readonly estimatedInputTokens: number;
  readonly tenantPolicy: TenantModelPolicy | undefined;
  readonly now: Date;
};

/**
 * Judge every candidate the policy names, in policy order. Preferred
 * models come first, then fallbacks; the order of the eligible list is
 * the order the gateway will try them in.
 */
export function planRoute(
  input: EligibilityInput,
  policy: RoutingPolicyRecord,
): RoutePlan {
  const { catalog, request } = input;
  const modelIds = [...policy.preferredModels, ...policy.fallbackModels];
  const decisions: ModelCandidateDecision[] = [];
  const eligible: EligibleCandidate[] = [];

  modelIds.forEach((modelId, candidateIndex) => {
    const model = catalog.modelById.get(modelId);
    if (model === undefined) {
      // A policy naming a model that does not exist is a configuration
      // fault, recorded as such rather than silently skipped.
      decisions.push({
        providerCode: "unknown",
        modelCode: modelId,
        candidateIndex,
        reason: "MODEL_DISABLED",
      });
      return;
    }
    const provider = catalog.providerById.get(model.providerId);
    const providerCode = provider?.code ?? "unknown";
    const decide = (reason: ModelEligibilityReason) => {
      decisions.push({
        providerCode,
        modelCode: model.modelCode,
        candidateIndex,
        reason,
      });
    };

    if (provider === undefined || provider.status !== "ACTIVE") {
      decide("PROVIDER_DISABLED");
      return;
    }
    if (input.registry.get(provider.code) === undefined) {
      decide("PROVIDER_UNCONFIGURED");
      return;
    }
    if (
      input.health.state(provider.code, input.now) === "TEMPORARILY_FAILING"
    ) {
      decide("PROVIDER_TEMPORARILY_FAILING");
      return;
    }
    if (model.status !== "ACTIVE") {
      decide("MODEL_DISABLED");
      return;
    }
    if (!isModelEffective(model, input.now)) {
      decide("MODEL_NOT_EFFECTIVE");
      return;
    }
    // Privacy before everything that follows: the ceiling is the reviewed
    // policy record, and nothing cheaper or more available can lower it.
    if (!sensitivityAtMost(request.sensitivity, model.sensitivityCeiling)) {
      decide("SENSITIVITY_EXCEEDS_CEILING");
      return;
    }
    if (!tenantAllows(input.tenantPolicy, provider.code)) {
      decide("TENANT_POLICY_DENIES_PROVIDER");
      return;
    }
    const capabilities = modelCapabilities(model);
    if (input.requiredCapabilities.some((c) => !capabilities.has(c))) {
      decide("CAPABILITY_MISSING");
      return;
    }
    const outputTokens = Math.min(
      request.budget.maxOutputTokens,
      model.maxOutputTokens,
    );
    if (request.budget.maxOutputTokens > model.maxOutputTokens) {
      decide("OUTPUT_LIMIT_TOO_SMALL");
      return;
    }
    if (input.estimatedInputTokens + outputTokens > model.contextWindow) {
      decide("CONTEXT_WINDOW_TOO_SMALL");
      return;
    }
    if (
      request.budget.maxInputTokens !== undefined &&
      input.estimatedInputTokens > request.budget.maxInputTokens
    ) {
      decide("CONTEXT_WINDOW_TOO_SMALL");
      return;
    }
    const floor = strongerQuality(policy.qualityFloor, request.qualityFloor);
    if (!meetsQuality(model, floor)) {
      decide("QUALITY_BELOW_FLOOR");
      return;
    }
    if (
      request.latencyTarget !== undefined &&
      !meetsLatency(model, request.latencyTarget)
    ) {
      decide("LATENCY_ABOVE_TARGET");
      return;
    }
    const price = effectivePrice(catalog, model.id, input.now);
    const ceiling = Math.min(
      request.budget.maxEstimatedCostUsd,
      policy.costCeilingUsd ?? Number.POSITIVE_INFINITY,
    );
    if (price === null) {
      // Unknown price is not free: with a ceiling to honour, a route we
      // cannot cost is a route we cannot take.
      decide("PRICE_UNKNOWN");
      return;
    }
    const estimate = estimateAttemptCost(
      input.estimatedInputTokens,
      outputTokens,
      price,
    );
    if (estimate.amount > ceiling) {
      decide("COST_EXCEEDS_CEILING");
      return;
    }
    decide("ELIGIBLE");
    eligible.push({
      candidateIndex,
      provider,
      model,
      price,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedAttemptCostUsd: estimate.amount,
    });
  });

  return { policy, decisions, eligible };
}

function strongerQuality(
  a: ModelQualityClass,
  b: ModelQualityClass | undefined,
): ModelQualityClass {
  if (b === undefined) {
    return a;
  }
  return MODEL_QUALITY_RANK[a] >= MODEL_QUALITY_RANK[b] ? a : b;
}
