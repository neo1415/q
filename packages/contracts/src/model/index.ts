import { z } from "zod";

import { UtcTimestampSchema, UuidSchema } from "../common/index.js";
import { MessageSensitivitySchema } from "../messaging/sensitivity.js";
import { Q_SENSITIVITY_RANK } from "../q/firewall.js";

/**
 * Model Gateway contracts (doc 12 §24, §27, §48-51; doc 13 §56; doc 15 §61-62,
 * §88; CQ-Q-005).
 *
 * The provider-neutral vocabulary through which Capital Q asks for model
 * work and receives a normalized result. Nothing here names a vendor, a
 * model, an SDK type or a price: business code requests a TASK CLASS under
 * a SENSITIVITY with a BUDGET; the gateway's data-driven policy chooses a
 * configured provider/model, and the caller learns which one was used
 * only as operational metadata on the result.
 *
 *   Q                         ≠ model provider
 *   task class                ≠ specific model name
 *   model output              ≠ canonical truth
 *   provider success          ≠ Q correctness
 *   free                      ≠ safe · cheap ≠ bad · expensive ≠ good
 *   available model           ≠ eligible model
 *   Context Firewall decision ≠ provider data-use eligibility
 *
 * INTERNAL. None of these shapes is part of the public Q API: a client
 * cannot name a provider or a model, and no public schema imports this
 * module.
 */

// ---------------------------------------------------------------------------
// Task classes
// ---------------------------------------------------------------------------

/** The source-backed task classes (doc 12 §24.3). */
export const MODEL_TASK_CLASSES = [
  "FAST_CLASSIFICATION",
  "STRUCTURED_EXTRACTION",
  "TAXONOMY_MAPPING",
  "NORMAL_DIALOGUE",
  "EVIDENCE_SYNTHESIS",
  "COMPARISON",
  "DEEP_INVESTIGATION",
  "REALTIME_VOICE",
  "GUARDRAIL",
  "EMBEDDING",
] as const;
export const ModelTaskClassSchema = z.enum(MODEL_TASK_CLASSES);
export type ModelTaskClass = z.infer<typeof ModelTaskClassSchema>;

/**
 * The classes this gateway version executes: text generation only.
 * EMBEDDING is CQ-RAG-002, REALTIME_VOICE is later, and GUARDRAIL is
 * deterministic wherever possible — a class existing is not a reason to
 * call a model for it.
 */
export const MODEL_TEXT_TASK_CLASSES = [
  "FAST_CLASSIFICATION",
  "STRUCTURED_EXTRACTION",
  "TAXONOMY_MAPPING",
  "NORMAL_DIALOGUE",
  "EVIDENCE_SYNTHESIS",
  "COMPARISON",
  "DEEP_INVESTIGATION",
] as const satisfies readonly ModelTaskClass[];
export const ModelTextTaskClassSchema = z.enum(MODEL_TEXT_TASK_CLASSES);
export type ModelTextTaskClass = z.infer<typeof ModelTextTaskClassSchema>;

// ---------------------------------------------------------------------------
// Sensitivity, capabilities, quality, latency
// ---------------------------------------------------------------------------

/** The doc 15 §20 baseline, exactly the vocabulary the Context Firewall emits. */
export const ModelSensitivitySchema = MessageSensitivitySchema;
export type ModelSensitivity = z.infer<typeof ModelSensitivitySchema>;

/** PUBLIC (0) … RESTRICTED (5). Shared with the Context Firewall's ranking. */
export const MODEL_SENSITIVITY_RANK = Q_SENSITIVITY_RANK;

export function sensitivityAtMost(
  sensitivity: ModelSensitivity,
  ceiling: ModelSensitivity,
): boolean {
  return MODEL_SENSITIVITY_RANK[sensitivity] <= MODEL_SENSITIVITY_RANK[ceiling];
}

/** Capability attributes a model may carry (doc 12 §24.2). */
export const MODEL_CAPABILITIES = [
  "TEXT_GENERATION",
  "STRUCTURED_OUTPUT",
  "TOOL_CALLING",
  "VISION",
  "DOCUMENT_INPUT",
  "AUDIO_INPUT",
  "AUDIO_OUTPUT",
  "REALTIME",
  "REASONING",
  "PROMPT_CACHE",
  "EMBEDDING",
] as const;
export const ModelCapabilitySchema = z.enum(MODEL_CAPABILITIES);
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

/** Ordered: a floor of STANDARD admits STANDARD, HIGH and FRONTIER. */
export const MODEL_QUALITY_CLASSES = [
  "BASIC",
  "STANDARD",
  "HIGH",
  "FRONTIER",
] as const;
export const ModelQualityClassSchema = z.enum(MODEL_QUALITY_CLASSES);
export type ModelQualityClass = z.infer<typeof ModelQualityClassSchema>;
export const MODEL_QUALITY_RANK: Readonly<Record<ModelQualityClass, number>> = {
  BASIC: 0,
  STANDARD: 1,
  HIGH: 2,
  FRONTIER: 3,
};

/** Ordered fastest first: a target of STANDARD admits REALTIME, FAST, STANDARD. */
export const MODEL_LATENCY_CLASSES = [
  "REALTIME",
  "FAST",
  "STANDARD",
  "SLOW",
] as const;
export const ModelLatencyClassSchema = z.enum(MODEL_LATENCY_CLASSES);
export type ModelLatencyClass = z.infer<typeof ModelLatencyClassSchema>;
export const MODEL_LATENCY_RANK: Readonly<Record<ModelLatencyClass, number>> = {
  REALTIME: 0,
  FAST: 1,
  STANDARD: 2,
  SLOW: 3,
};

/** A provider-neutral request for effort; each adapter maps or ignores it. */
export const MODEL_REASONING_LEVELS = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;
export const ModelReasoningLevelSchema = z.enum(MODEL_REASONING_LEVELS);
export type ModelReasoningLevel = z.infer<typeof ModelReasoningLevelSchema>;

// ---------------------------------------------------------------------------
// Provider and model policy vocabulary (persisted in ai_ops, doc 13 §56)
// ---------------------------------------------------------------------------

/**
 * What a provider's terms say about the data we send. A CLASS of the
 * endpoint configuration under review — never a nationality, never a
 * price tier (doc 15 §62). UNREVIEWED is the default for anything whose
 * terms Capital Q has not verified from a primary document.
 */
export const PROVIDER_PRIVACY_POLICY_CLASSES = [
  "UNREVIEWED",
  "TRAINING_PERMITTED",
  "NO_TRAINING_DEFAULT_RETENTION",
  "NO_TRAINING_ZERO_RETENTION",
  "ENTERPRISE_CONTRACT",
] as const;
export const ProviderPrivacyPolicyClassSchema = z.enum(
  PROVIDER_PRIVACY_POLICY_CLASSES,
);
export type ProviderPrivacyPolicyClass = z.infer<
  typeof ProviderPrivacyPolicyClassSchema
>;

export const PROVIDER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const ProviderStatusSchema = z.enum(PROVIDER_STATUSES);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const MODEL_STATUSES = ["ACTIVE", "DISABLED", "RETIRED"] as const;
export const ModelStatusSchema = z.enum(MODEL_STATUSES);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const MODEL_TYPES = [
  "TEXT_GENERATION",
  "EMBEDDING",
  "REALTIME",
  "RERANKING",
] as const;
export const ModelTypeSchema = z.enum(MODEL_TYPES);
export type ModelType = z.infer<typeof ModelTypeSchema>;

export const ROUTING_POLICY_STATUSES = ["ACTIVE", "RETIRED"] as const;
export const RoutingPolicyStatusSchema = z.enum(ROUTING_POLICY_STATUSES);
export type RoutingPolicyStatus = z.infer<typeof RoutingPolicyStatusSchema>;

/** Lowercase provider code as persisted: `google`, `groq`. */
export const ModelProviderCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,31}$/);
export type ModelProviderCode = z.infer<typeof ModelProviderCodeSchema>;

/** A provider's own model identifier, e.g. `openai/gpt-oss-120b`. Opaque to business code. */
export const ModelCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$/);
export type ModelCode = z.infer<typeof ModelCodeSchema>;

/** Durable identity of the routing policy a call was made under. */
export const RoutingPolicyCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.v[0-9]{1,4}$/);
export type RoutingPolicyCode = z.infer<typeof RoutingPolicyCodeSchema>;

// ---------------------------------------------------------------------------
// Failure classes
// ---------------------------------------------------------------------------

/** Stable classes every provider error maps onto (doc 12 §48; packet §35). */
export const MODEL_FAILURE_CLASSES = [
  "TRANSIENT",
  "RATE_LIMIT",
  "PROVIDER_OUTAGE",
  "TIMEOUT",
  "INVALID_MODEL_OUTPUT",
  "INVALID_REQUEST",
  "CONTEXT_LIMIT",
  "AUTHENTICATION",
  "POLICY_INELIGIBLE",
  "BUDGET_EXCEEDED",
  "CANCELLED",
  "PERMANENT",
] as const;
export const ModelFailureClassSchema = z.enum(MODEL_FAILURE_CLASSES);
export type ModelFailureClass = z.infer<typeof ModelFailureClassSchema>;

/** Another attempt on the SAME model may plausibly succeed. */
export const MODEL_RETRYABLE_FAILURE_CLASSES = [
  "TRANSIENT",
  "RATE_LIMIT",
  "PROVIDER_OUTAGE",
  "TIMEOUT",
  "INVALID_MODEL_OUTPUT",
] as const satisfies readonly ModelFailureClass[];

/**
 * Another ELIGIBLE candidate may be tried. Never CANCELLED (the person
 * stopped it), BUDGET_EXCEEDED (spending more is the problem),
 * POLICY_INELIGIBLE (nothing was eligible) or INVALID_REQUEST (ours).
 */
export const MODEL_FALLBACK_FAILURE_CLASSES = [
  "TRANSIENT",
  "RATE_LIMIT",
  "PROVIDER_OUTAGE",
  "TIMEOUT",
  "INVALID_MODEL_OUTPUT",
  "CONTEXT_LIMIT",
  "AUTHENTICATION",
  "PERMANENT",
] as const satisfies readonly ModelFailureClass[];

export function isRetryableModelFailure(cls: ModelFailureClass): boolean {
  return (MODEL_RETRYABLE_FAILURE_CLASSES as readonly string[]).includes(cls);
}

export function allowsModelFallback(cls: ModelFailureClass): boolean {
  return (MODEL_FALLBACK_FAILURE_CLASSES as readonly string[]).includes(cls);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const MODEL_MESSAGE_ROLES = [
  "SYSTEM",
  "USER",
  "ASSISTANT",
  "TOOL",
] as const;
export const ModelMessageRoleSchema = z.enum(MODEL_MESSAGE_ROLES);
export type ModelMessageRole = z.infer<typeof ModelMessageRoleSchema>;

/** Bounded so a request can never carry an unbounded document by accident. */
export const MODEL_MESSAGE_MAX_CHARS = 400_000;
export const MODEL_MESSAGES_MAX = 64;

// ---------------------------------------------------------------------------
// Tools (doc 12 §28, §33; doc 15 §49-52; CQ-Q-007)
// ---------------------------------------------------------------------------

/**
 * The name a model sees for a registered tool: a flat lower_snake_case
 * identifier every provider accepts as a function name. It is a
 * PROJECTION of a Capital Q tool id, chosen by the Tool Registry; a model
 * cannot name a tool the registry did not offer for this run.
 */
export const ModelToolNameSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
export type ModelToolName = z.infer<typeof ModelToolNameSchema>;

export const MODEL_TOOLS_MAX = 16;
export const MODEL_TOOL_DESCRIPTION_MAX_CHARS = 1_000;
/** Bounded tool result text handed back to a model (JSON). */
export const MODEL_TOOL_RESULT_MAX_CHARS = 32_000;
export const MODEL_TOOL_CALLS_MAX = 8;

/**
 * A canonical, provider-neutral tool declaration. The adapters project
 * it into a vendor's function-declaration shape and never add a tool of
 * their own (no provider search, code execution or connectors).
 */
export const ModelToolDefinitionSchema = z
  .object({
    name: ModelToolNameSchema,
    description: z.string().min(1).max(MODEL_TOOL_DESCRIPTION_MAX_CHARS),
    inputJsonSchema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ModelToolDefinition = z.infer<typeof ModelToolDefinitionSchema>;

/**
 * A model's PROPOSAL to call a tool: the offered name and the decoded
 * arguments. Nothing about it is trusted: the Tool Registry validates the
 * arguments like external input and decides whether anything runs.
 */
export const ModelToolCallSchema = z
  .object({
    /** The provider's call identifier, or one the adapter assigned. Opaque. */
    callId: z.string().min(1).max(128),
    name: ModelToolNameSchema,
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ModelToolCall = z.infer<typeof ModelToolCallSchema>;

/**
 * Conversation messages. SYSTEM and USER carry text; an ASSISTANT turn
 * carries text and/or the tool calls the model made; a TOOL turn carries
 * one tool's bounded JSON result for the call it answers. Tool results
 * are data the model reads, never instructions it must follow: the
 * caller fences and labels them accordingly.
 */
export const ModelTextMessageSchema = z
  .object({
    role: z.enum(["SYSTEM", "USER"]),
    content: z.string().min(1).max(MODEL_MESSAGE_MAX_CHARS),
  })
  .strict();

export const ModelAssistantMessageSchema = z
  .object({
    role: z.literal("ASSISTANT"),
    content: z.string().max(MODEL_MESSAGE_MAX_CHARS),
    toolCalls: z
      .array(ModelToolCallSchema)
      .max(MODEL_TOOL_CALLS_MAX)
      .optional(),
  })
  .strict()
  .refine(
    (message) =>
      message.content.length > 0 ||
      (message.toolCalls !== undefined && message.toolCalls.length > 0),
    { message: "an assistant message carries text or tool calls" },
  );

export const ModelToolMessageSchema = z
  .object({
    role: z.literal("TOOL"),
    callId: z.string().min(1).max(128),
    name: ModelToolNameSchema,
    content: z.string().min(1).max(MODEL_TOOL_RESULT_MAX_CHARS),
  })
  .strict();

export const ModelMessageSchema = z.union([
  ModelTextMessageSchema,
  ModelAssistantMessageSchema,
  ModelToolMessageSchema,
]);
export type ModelMessage = z.infer<typeof ModelMessageSchema>;

/**
 * What the caller wants back. A structured request carries the JSON
 * Schema the provider is asked to honour; the Zod schema that VALIDATES
 * the result travels beside the request in code, because provider JSON
 * that parses is not yet accepted data.
 */
export const ModelOutputSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT") }).strict(),
  z
    .object({
      kind: z.literal("STRUCTURED"),
      schemaName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
      jsonSchema: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export type ModelOutputSpec = z.infer<typeof ModelOutputSpecSchema>;

/** Every execution is bounded (doc 12 §49; TM cost harvesting). */
export const ModelBudgetSchema = z
  .object({
    /** Model attempts across retries AND fallbacks. */
    maxAttempts: z.number().int().min(1).max(6),
    /** Cumulative estimated spend across all attempts, USD. */
    maxEstimatedCostUsd: z.number().positive().max(50),
    maxOutputTokens: z.number().int().min(1).max(65_536),
    /** Per-attempt wall clock. */
    attemptTimeoutMs: z.number().int().min(1_000).max(180_000),
    /** Optional cap on what we are willing to send; the model window still applies. */
    maxInputTokens: z.number().int().min(1).max(2_000_000).optional(),
  })
  .strict();
export type ModelBudget = z.infer<typeof ModelBudgetSchema>;

/** Who is paying and which run is asking. Identifiers only. */
export const ModelAttributionSchema = z
  .object({
    tenantId: UuidSchema,
    userId: UuidSchema.optional(),
    qRunId: UuidSchema.optional(),
    correlationId: z.string().min(1).max(128),
  })
  .strict();
export type ModelAttribution = z.infer<typeof ModelAttributionSchema>;

/**
 * Tenant-level provider policy (doc 15 §61 "tenant data policy"). Codes
 * only; absent means no tenant restriction beyond platform policy. A
 * tenant can narrow eligibility, never widen it.
 */
export const TenantModelPolicySchema = z
  .object({
    deniedProviderCodes: z.array(ModelProviderCodeSchema).max(32).default([]),
    /** When present, only these providers may serve the tenant. */
    allowedProviderCodes: z.array(ModelProviderCodeSchema).max(32).optional(),
  })
  .strict();
export type TenantModelPolicy = z.infer<typeof TenantModelPolicySchema>;

/**
 * INTERNAL. The gateway request. There is no field for a provider, a
 * model, a credential, a raw provider option or a free-form extension:
 * the route is the gateway's decision, made from data.
 */
export const ModelGatewayRequestSchema = z
  .object({
    taskClass: ModelTextTaskClassSchema,
    /** The strongest class of anything in `messages`. Declared by the caller, who assembled them. */
    sensitivity: ModelSensitivitySchema,
    messages: z.array(ModelMessageSchema).min(1).max(MODEL_MESSAGES_MAX),
    output: ModelOutputSpecSchema,
    /**
     * Tools the model may propose calling on this attempt. Offered by the
     * Tool Registry for this run only; empty means none. Combined with a
     * TEXT output because no configured provider honours a JSON response
     * schema and function calling on the same call.
     */
    tools: z.array(ModelToolDefinitionSchema).max(MODEL_TOOLS_MAX).default([]),
    requiredCapabilities: z.array(ModelCapabilitySchema).max(8).default([]),
    qualityFloor: ModelQualityClassSchema.optional(),
    latencyTarget: ModelLatencyClassSchema.optional(),
    reasoning: ModelReasoningLevelSchema.default("NONE"),
    temperature: z.number().min(0).max(2).optional(),
    budget: ModelBudgetSchema,
    attribution: ModelAttributionSchema,
    tenantPolicy: TenantModelPolicySchema.optional(),
  })
  .strict()
  .refine(
    (request) => request.tools.length === 0 || request.output.kind === "TEXT",
    {
      message: "tools are offered with TEXT output only",
      path: ["tools"],
    },
  )
  .refine(
    (request) =>
      new Set(request.tools.map((tool) => tool.name)).size ===
      request.tools.length,
    { message: "tool names must be unique", path: ["tools"] },
  );
export type ModelGatewayRequest = z.infer<typeof ModelGatewayRequestSchema>;
export type ModelGatewayRequestInput = z.input<
  typeof ModelGatewayRequestSchema
>;

// ---------------------------------------------------------------------------
// Usage, cost, result
// ---------------------------------------------------------------------------

export const ModelUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    /** Reasoning tokens billed as output where the provider reports them. Counts only, never content. */
    reasoningTokens: z.number().int().min(0).optional(),
  })
  .strict();
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

/**
 * How a cost figure was arrived at. PRICE_SNAPSHOT: provider-reported
 * usage priced with the effective ai_ops price row. ESTIMATED: our own
 * token estimate priced the same way (no usage reported). UNPRICED: no
 * effective price row existed — the number is 0 and means "unknown", not
 * "free".
 */
export const MODEL_COST_BASES = [
  "PRICE_SNAPSHOT",
  "ESTIMATED",
  "UNPRICED",
] as const;
export const ModelCostBasisSchema = z.enum(MODEL_COST_BASES);
export type ModelCostBasis = z.infer<typeof ModelCostBasisSchema>;

export const ModelCostSchema = z
  .object({
    currency: z.literal("USD"),
    amount: z.number().min(0),
    basis: ModelCostBasisSchema,
    /** The price row used, when one was. */
    priceSnapshotId: UuidSchema.optional(),
  })
  .strict();
export type ModelCost = z.infer<typeof ModelCostSchema>;

export const MODEL_FINISH_STATUSES = [
  "COMPLETE",
  "MAX_OUTPUT_TOKENS",
  "CONTENT_FILTERED",
  /** The model stopped to propose tool calls (only meaningful when tools were offered). */
  "TOOL_CALLS",
  "OTHER",
] as const;
export const ModelFinishStatusSchema = z.enum(MODEL_FINISH_STATUSES);
export type ModelFinishStatus = z.infer<typeof ModelFinishStatusSchema>;

/** One provider attempt, as recorded in the usage ledger. Never content. */
export const ModelAttemptRecordSchema = z
  .object({
    attempt: z.number().int().min(1),
    providerCode: ModelProviderCodeSchema,
    modelCode: ModelCodeSchema,
    outcome: z.union([z.literal("SUCCESS"), ModelFailureClassSchema]),
    latencyMs: z.number().int().min(0),
    usage: ModelUsageSchema.optional(),
    cost: ModelCostSchema.optional(),
    /** Fallback index: 0 for the first candidate, 1 for the first fallback. */
    candidateIndex: z.number().int().min(0),
  })
  .strict();
export type ModelAttemptRecord = z.infer<typeof ModelAttemptRecordSchema>;

/** Why a candidate was or was not usable. Deterministic; explainable internally (packet §77). */
export const MODEL_ELIGIBILITY_REASONS = [
  "ELIGIBLE",
  "PROVIDER_DISABLED",
  "PROVIDER_UNCONFIGURED",
  "PROVIDER_TEMPORARILY_FAILING",
  "MODEL_DISABLED",
  "MODEL_NOT_EFFECTIVE",
  "SENSITIVITY_EXCEEDS_CEILING",
  "TENANT_POLICY_DENIES_PROVIDER",
  "CAPABILITY_MISSING",
  "CONTEXT_WINDOW_TOO_SMALL",
  "OUTPUT_LIMIT_TOO_SMALL",
  "QUALITY_BELOW_FLOOR",
  "LATENCY_ABOVE_TARGET",
  "COST_EXCEEDS_CEILING",
  "PRICE_UNKNOWN",
] as const;
export const ModelEligibilityReasonSchema = z.enum(MODEL_ELIGIBILITY_REASONS);
export type ModelEligibilityReason = z.infer<
  typeof ModelEligibilityReasonSchema
>;

export const ModelCandidateDecisionSchema = z
  .object({
    providerCode: ModelProviderCodeSchema,
    modelCode: ModelCodeSchema,
    candidateIndex: z.number().int().min(0),
    reason: ModelEligibilityReasonSchema,
  })
  .strict();
export type ModelCandidateDecision = z.infer<
  typeof ModelCandidateDecisionSchema
>;

/** The internal route explanation. Operational metadata; never a client payload. */
export const ModelRouteSchema = z
  .object({
    routingPolicyCode: RoutingPolicyCodeSchema,
    routingPolicyVersion: z.number().int().min(1),
    candidates: z.array(ModelCandidateDecisionSchema).max(32),
    /** The candidate that produced the result. */
    selectedCandidateIndex: z.number().int().min(0),
    fallbackUsed: z.boolean(),
  })
  .strict();
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

/**
 * INTERNAL. Safe operational metadata of a successful execution. What it
 * must never carry: a key, a header, the request, the full provider
 * response, hidden reasoning. The typed output travels beside it in code.
 */
export const ModelGatewayResultMetadataSchema = z
  .object({
    providerCode: ModelProviderCodeSchema,
    modelCode: ModelCodeSchema,
    taskClass: ModelTextTaskClassSchema,
    routingPolicyCode: RoutingPolicyCodeSchema,
    usage: ModelUsageSchema,
    latencyMs: z.number().int().min(0),
    finish: ModelFinishStatusSchema,
    cost: ModelCostSchema,
    attempts: z.array(ModelAttemptRecordSchema).min(1).max(6),
    fallbackUsed: z.boolean(),
    /** An opaque provider request/response reference, when the provider gives one and it is safe. */
    providerReference: z.string().max(255).optional(),
    route: ModelRouteSchema,
    completedAt: UtcTimestampSchema,
  })
  .strict();
export type ModelGatewayResultMetadata = z.infer<
  typeof ModelGatewayResultMetadataSchema
>;

export type ModelGatewayOutput<T> =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "STRUCTURED"; readonly value: T }
  | {
      /** The model proposed tool calls, each naming a tool the request offered. */
      readonly kind: "TOOL_CALLS";
      readonly calls: readonly ModelToolCall[];
      /** Any text the model emitted alongside; informational. */
      readonly text: string;
    };

export type ModelGatewayResult<T> = ModelGatewayResultMetadata & {
  readonly output: ModelGatewayOutput<T>;
};

/**
 * A denial recorded before any provider was called. The gateway reports
 * it as a POLICY_INELIGIBLE or BUDGET_EXCEEDED failure; the decisions are
 * kept so the route can be explained.
 */
export const ModelGatewayDenialSchema = z
  .object({
    failureClass: z.enum([
      "POLICY_INELIGIBLE",
      "BUDGET_EXCEEDED",
      "INVALID_REQUEST",
    ]),
    routingPolicyCode: RoutingPolicyCodeSchema.optional(),
    candidates: z.array(ModelCandidateDecisionSchema).max(32),
  })
  .strict();
export type ModelGatewayDenial = z.infer<typeof ModelGatewayDenialSchema>;
