import type {
  ModelAttemptRecord,
  ModelCapability,
  ModelCode,
  ModelCostBasis,
  ModelFailureClass,
  ModelFinishStatus,
  ModelMessage,
  ModelOutputSpec,
  ModelProviderCode,
  ModelReasoningLevel,
  ModelTaskClass,
  ModelToolCall,
  ModelToolDefinition,
  ModelUsage,
  TenantModelPolicy,
} from "@capital-q/contracts";

import type { ModelCatalogSnapshot } from "./catalog.js";

/**
 * The ports of the Model Gateway (doc 12 §24.1; doc 22 §140).
 *
 * A ModelProvider is a thin adapter over one vendor: it maps a
 * provider-neutral request to the vendor's API, and the vendor's answer and
 * errors back to Capital Q's shapes. It does not route, retry, budget,
 * validate schemas or account for cost — the gateway does all of that
 * against this port, which is also why a deterministic fake provider can
 * prove the gateway's behaviour without an SDK in sight.
 */

/** What the gateway hands an adapter for ONE attempt. Never a credential. */
export type ModelProviderRequest = {
  readonly modelCode: ModelCode;
  readonly messages: readonly ModelMessage[];
  readonly output: ModelOutputSpec;
  /** Canonical tool declarations to project; empty means no tool of any kind. */
  readonly tools: readonly ModelToolDefinition[];
  readonly maxOutputTokens: number;
  readonly temperature: number | undefined;
  readonly reasoning: ModelReasoningLevel;
};

export type ModelExecutionContext = {
  /** Aborts on the caller's cancellation OR the attempt timeout. */
  readonly signal: AbortSignal;
  readonly attemptTimeoutMs: number;
  readonly attempt: number;
  readonly correlationId: string;
};

/**
 * What an adapter returns. `text` is the raw model text (or JSON text for a
 * structured request) — the gateway validates it; nothing else in the
 * provider's response is surfaced. No hidden reasoning, no raw payload.
 */
export type ModelProviderResult = {
  /** Raw model text; may be empty when the model only proposed tool calls. */
  readonly text: string;
  /** Tool calls the model proposed, decoded; undefined or empty when none. */
  readonly toolCalls: readonly ModelToolCall[] | undefined;
  readonly usage: ModelUsage | undefined;
  readonly finish: ModelFinishStatus;
  /** The model the provider says it ran, when it says. */
  readonly modelCode: ModelCode;
  /** Opaque provider request/response id, safe to log. */
  readonly providerReference: string | undefined;
};

export type ModelProviderCapabilities = {
  readonly structuredOutput: boolean;
  readonly toolCalling: boolean;
  readonly streaming: boolean;
  readonly cancellation: boolean;
};

export type ModelProvider = {
  readonly code: ModelProviderCode;
  readonly capabilities: () => ModelProviderCapabilities;
  /** Rejects with ModelProviderFailure; never with a vendor exception. */
  readonly generate: (
    request: ModelProviderRequest,
    context: ModelExecutionContext,
  ) => Promise<ModelProviderResult>;
};

/** The configured adapters, by provider code. Absent = unconfigured. */
export type ModelProviderRegistry = {
  readonly get: (code: ModelProviderCode) => ModelProvider | undefined;
  readonly codes: () => readonly ModelProviderCode[];
};

export function createModelProviderRegistry(
  providers: readonly ModelProvider[],
): ModelProviderRegistry {
  const byCode = new Map<ModelProviderCode, ModelProvider>();
  for (const provider of providers) {
    if (byCode.has(provider.code)) {
      throw new Error(`duplicate model provider adapter: ${provider.code}`);
    }
    byCode.set(provider.code, provider);
  }
  return {
    get: (code) => byCode.get(code),
    codes: () => [...byCode.keys()],
  };
}

/** Loads the routing configuration. Implementations may cache briefly. */
export type ModelCatalogPort = {
  readonly load: () => Promise<ModelCatalogSnapshot>;
};

/** One ledger row per real attempt (doc 13 §56.5). Never content. */
export type ModelUsageEntry = {
  readonly tenantId: string;
  readonly userId: string | undefined;
  readonly qRunId: string | undefined;
  readonly taskClass: ModelTaskClass;
  readonly providerId: string;
  readonly modelId: string;
  readonly routingPolicyId: string | undefined;
  readonly attempt: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly costUsd: number | undefined;
  readonly costBasis: ModelCostBasis;
  readonly success: boolean;
  readonly errorCode: ModelFailureClass | undefined;
  readonly correlationId: string | undefined;
};

export type ModelUsageRepository = {
  readonly record: (entry: ModelUsageEntry) => Promise<void>;
};

/** Tenant-level provider policy; absent means platform policy only. */
export type TenantModelPolicyPort = {
  readonly policyFor: (
    tenantId: string,
  ) => Promise<TenantModelPolicy | undefined>;
};

export const noTenantModelPolicy: TenantModelPolicyPort = {
  policyFor: () => Promise.resolve(undefined),
};

/**
 * Provider health as the gateway sees it from its own process: bounded,
 * non-authoritative and never a security input (packet §46). A provider in
 * TEMPORARILY_FAILING is skipped for a short window; nothing here can make
 * an ineligible provider eligible.
 */
export type ProviderHealthState = "HEALTHY" | "TEMPORARILY_FAILING";

export type ProviderHealthPort = {
  readonly state: (code: ModelProviderCode, at: Date) => ProviderHealthState;
  readonly recordFailure: (
    code: ModelProviderCode,
    failureClass: ModelFailureClass,
    at: Date,
  ) => void;
  readonly recordSuccess: (code: ModelProviderCode, at: Date) => void;
};

export type ModelClock = { readonly now: () => Date };
export const systemModelClock: ModelClock = { now: () => new Date() };

/** Capability attributes an adapter's model must carry for a request. */
export function requiredCapabilitiesFor(
  output: ModelOutputSpec,
  requested: readonly ModelCapability[],
  tools: readonly ModelToolDefinition[] = [],
): readonly ModelCapability[] {
  const set = new Set<ModelCapability>(["TEXT_GENERATION", ...requested]);
  if (output.kind === "STRUCTURED") {
    set.add("STRUCTURED_OUTPUT");
  }
  if (tools.length > 0) {
    set.add("TOOL_CALLING");
  }
  return [...set];
}

export type { ModelAttemptRecord };
