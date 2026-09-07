/**
 * @capital-q/model-gateway
 *
 * Owns: the one provider-neutral inference boundary (doc 12 §24; CQ-Q-005)
 * — the ModelGateway, its ports, the deterministic eligibility and routing
 * policy over the ai_ops catalog, budgets, timeouts, cancellation, bounded
 * retry and fallback, structured-output acceptance, cost calculation, the
 * usage ledger and model-call telemetry — plus the deterministic fake
 * provider software tests run against.
 *
 * Does not own: prompts (CQ-Q-006), the Context Firewall (CQ-Q-004),
 * retrieval (CQ-RAG), tools (CQ-Q-007), approvals (CQ-Q-008), Q memory,
 * Q knowledge, or any business meaning of a model's words. A model result
 * is a model result: nothing here writes canonical company, investor,
 * evidence or relationship truth.
 *
 * Provider SDKs are imported only behind the `./providers/google` and
 * `./providers/groq` subpaths; nothing on this entry point loads one.
 * Server-only.
 */

export {
  effectivePrice,
  indexCatalog,
  isModelEffective,
  ModelCatalogSnapshotSchema,
  ModelPriceRecordSchema,
  ModelRecordSchema,
  ProviderRecordSchema,
  RoutingPolicyRecordSchema,
  type ModelCatalog,
  type ModelCatalogSnapshot,
  type ModelPriceRecord,
  type ModelRecord,
  type ProviderRecord,
  type RoutingPolicyRecord,
} from "./catalog.js";

export {
  isModelGatewayError,
  ModelGatewayError,
  ModelProviderFailure,
  type ModelGatewayErrorOptions,
  type ModelProviderFailureOptions,
} from "./errors.js";

export {
  createModelProviderRegistry,
  noTenantModelPolicy,
  requiredCapabilitiesFor,
  systemModelClock,
  type ModelCatalogPort,
  type ModelClock,
  type ModelExecutionContext,
  type ModelProvider,
  type ModelProviderCapabilities,
  type ModelProviderRegistry,
  type ModelProviderRequest,
  type ModelProviderResult,
  type ModelUsageEntry,
  type ModelUsageRepository,
  type ProviderHealthPort,
  type ProviderHealthState,
  type TenantModelPolicyPort,
} from "./ports.js";

export {
  createModelGateway,
  type ModelGateway,
  type ModelGatewayDependencies,
  type ModelGatewayExecuteOptions,
} from "./gateway.js";

export {
  estimateAttemptCost,
  estimateInputTokens,
  priceUsage,
} from "./policy/cost.js";
export {
  planRoute,
  selectRoutingPolicy,
  type EligibilityInput,
  type EligibleCandidate,
  type RoutePlan,
} from "./policy/eligibility.js";
export {
  alwaysHealthy,
  createProcessLocalProviderHealth,
  type ProviderHealthOptions,
} from "./policy/health.js";
export {
  acceptStructuredOutput,
  type StructuredOutcome,
} from "./policy/structured.js";

export {
  createFakeModelProvider,
  type FakeBehaviour,
  type FakeCall,
  type FakeModelProvider,
  type FakeModelProviderOptions,
} from "./providers/fake.js";

export {
  createPostgresModelCatalog,
  createStaticModelCatalog,
  loadModelCatalogSnapshot,
  type PostgresModelCatalogOptions,
} from "./infrastructure/postgres-catalog.js";
export {
  createInMemoryModelUsageRepository,
  createPostgresModelUsageRepository,
} from "./infrastructure/postgres-usage.js";

export const PACKAGE_NAME = "@capital-q/model-gateway" as const;
