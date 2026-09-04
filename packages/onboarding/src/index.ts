/**
 * @capital-q/onboarding
 *
 * Owns: the declarative onboarding runtime -- journey definitions and their
 * immutable published versions (onboarding.definitions,
 * definition_versions, steps), user-owned sessions pinned to a version
 * (onboarding.sessions), step states, validated historical responses,
 * non-authoritative suggestions, deterministic branching and progress, the
 * write-target seam into the canonical domains, and the runtime events.
 *
 * Does not own: Company, Investor, Capital Objective or Taxonomy truth;
 * Founder or Investor journey definitions and their write mappings
 * (CQ-ONB-002/003); Evidence, voice capture, Q or model suggestions.
 *
 *   onboarding response ≠ canonical domain state
 *   suggestion ≠ response ≠ truth
 *   published version = immutable; session = pinned
 *   tenant / organisation / subject bind once, one way
 */

export * from "./contracts/index.js";
export {
  BRANCH_MAX_DEPTH,
  BRANCH_OPERATORS,
  BranchExpressionSchema,
  ONBOARDING_DEFINITION_SCHEMA_VERSION,
  OnboardingDefinitionManifestSchema,
  OnboardingDefinitionSchemaV1,
  OnboardingOptionDefinitionSchema,
  OnboardingPhaseDefinitionSchema,
  OnboardingRuntimeSettingsSchema,
  OnboardingStepConfigurationSchema,
  OnboardingStepManifestSchema,
  OnboardingWriteTargetKeySchema,
  OnboardingWriteTargetSchema,
  type BranchExpression,
  type BranchScalar,
  type OnboardingDefinitionManifest,
  type OnboardingStepConfiguration,
  type OnboardingStepManifest,
  type OnboardingWriteTarget,
  type OnboardingWriteTargetKey,
} from "./definitions/schema.js";
export { validateOnboardingManifest } from "./definitions/validate.js";
export {
  ONBOARDING_RUNTIME_FAULTS,
  ONBOARDING_STATE_REASONS,
  OnboardingContextRequiredError,
  OnboardingDefinitionConflictError,
  OnboardingDefinitionInvalidError,
  OnboardingDefinitionUnavailableError,
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  OnboardingSessionStateError,
  OnboardingSessionVersionConflictError,
  OnboardingSubjectNotFoundError,
  OnboardingSuggestionNotFoundError,
  type OnboardingRuntimeFault,
  type OnboardingStateReason,
} from "./domain/errors.js";
export {
  canonicalise,
  hashOnboardingIdempotencyKey,
  hashOnboardingRequest,
  ONBOARDING_MUTATION_OPERATIONS,
  type OnboardingMutationOperation,
} from "./domain/idempotency.js";
export {
  branchDepth,
  evaluateBranch,
  referencedStepKeys,
  scalarOf,
  type ResponseSnapshot,
} from "./runtime/branch.js";
export {
  computeActivePath,
  computeProgress,
  nextIncompleteStep,
  pathChanges,
  previousVisitedStep,
  requiredStepsComplete,
  type ActivePath,
} from "./runtime/path.js";
export {
  compareDecimal,
  expectedResponseType,
  validateOnboardingResponse,
  type ValidateResponseOptions,
} from "./runtime/validate-response.js";
export type {
  NewOnboardingSession,
  NewOnboardingSuggestion,
  OnboardingDefinitionRepository,
  OnboardingIdempotencyRepository,
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingSessionUpdate,
  OnboardingStepStateRepository,
  OnboardingSubjectResolver,
  OnboardingSubjectResolverRegistry,
  OnboardingSuggestionRepository,
  OnboardingWriteContext,
  OnboardingWriteTargetHandler,
  OnboardingWriteTargetRegistry,
} from "./application/ports.js";
export {
  createCompanyOnboardingSubjectResolver,
  createOnboardingSubjectResolverRegistry,
  createOnboardingWriteTargetRegistry,
} from "./application/registry.js";
export {
  createOnboardingDefinitionPublisher,
  type OnboardingDefinitionPublisher,
} from "./application/publisher.js";
export {
  createDefinitionCache,
  loadAggregate,
  toResponseView,
  toSessionView,
  toStepView,
  toSuggestionView,
  type OnboardingSessionAggregate,
} from "./application/view.js";
export {
  createOnboardingUseCases,
  type BindSessionContextCommand,
  type CompleteOnboardingSessionCommand,
  type CreateOnboardingSuggestionCommand,
  type ExpireOnboardingSuggestionCommand,
  type OnboardingBackCommand,
  type OnboardingRuntimeDependencies,
  type OnboardingUseCases,
  type ResolveOnboardingSuggestionCommand,
  type SessionScopedQuery,
  type SkipOnboardingStepCommand,
  type StartOnboardingSessionCommand,
  type StartOnboardingSessionResult,
  type SubmitOnboardingResponseCommand,
} from "./application/use-cases.js";
export { getOnboardingMetrics } from "./application/metrics.js";
export {
  createOnboardingService,
  type OnboardingService,
  type OnboardingServiceOptions,
} from "./application/service.js";
export { createPostgresOnboardingDefinitionRepository } from "./infrastructure/postgres-definition-repository.js";
export {
  createPostgresOnboardingIdempotencyRepository,
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingStepStateRepository,
  createPostgresOnboardingSuggestionRepository,
} from "./infrastructure/postgres-session-repository.js";

export const PACKAGE_NAME = "@capital-q/onboarding" as const;
