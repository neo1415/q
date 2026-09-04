import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { Logger } from "@capital-q/observability";

import { createPostgresOnboardingDefinitionRepository } from "../infrastructure/postgres-definition-repository.js";
import {
  createPostgresOnboardingIdempotencyRepository,
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingStepStateRepository,
  createPostgresOnboardingSuggestionRepository,
} from "../infrastructure/postgres-session-repository.js";
import type {
  OnboardingDefinitionRepository,
  OnboardingIdempotencyRepository,
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingStepStateRepository,
  OnboardingStepContextProvider,
  OnboardingSubjectResolver,
  OnboardingSuggestionRepository,
  OnboardingWriteTargetHandler,
} from "./ports.js";
import {
  createOnboardingDefinitionPublisher,
  type OnboardingDefinitionPublisher,
} from "./publisher.js";
import {
  createOnboardingSubjectResolverRegistry,
  createOnboardingStepContextRegistry,
  createOnboardingWriteTargetRegistry,
} from "./registry.js";
import {
  createOnboardingUseCases,
  type OnboardingUseCases,
} from "./use-cases.js";

/**
 * The Onboarding application service. `runtime` is what the HTTP layer and
 * owning journey workflows call; `publisher` is the trusted reference-data
 * path; `internal` operations (context binding, suggestion creation and
 * expiry) are for CQ-ONB-002/003 and the future Q wave, never the browser.
 * Nothing here registers a Founder or Investor write handler.
 */
export type OnboardingService = {
  readonly runtime: Pick<
    OnboardingUseCases,
    | "startSession"
    | "getCurrentSession"
    | "getSession"
    | "submitResponse"
    | "skipStep"
    | "goBack"
    | "completeSession"
    | "resolveSuggestion"
  >;
  readonly internal: Pick<
    OnboardingUseCases,
    "bindSessionContext" | "createSuggestion" | "expireSuggestion"
  >;
  readonly publisher: OnboardingDefinitionPublisher;
};

export type OnboardingServiceOptions = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly outbox: OutboxWriter;
  /** Domain adapters for semantic write targets. Empty in CQ-ONB-001 production. */
  readonly writeTargets?: readonly OnboardingWriteTargetHandler[] | undefined;
  readonly subjectResolvers?: readonly OnboardingSubjectResolver[] | undefined;
  /** Journey-specific server-side step data (reviews, snapshots). Empty in CQ-ONB-001. */
  readonly stepContextProviders?:
    readonly OnboardingStepContextProvider[] | undefined;
  readonly repositories?:
    | {
        readonly definitions?: OnboardingDefinitionRepository | undefined;
        readonly sessions?: OnboardingSessionRepository | undefined;
        readonly stepStates?: OnboardingStepStateRepository | undefined;
        readonly responses?: OnboardingResponseRepository | undefined;
        readonly suggestions?: OnboardingSuggestionRepository | undefined;
        readonly idempotency?: OnboardingIdempotencyRepository | undefined;
      }
    | undefined;
  /** Safe structured logging only; never response content. */
  readonly logger?: Logger | undefined;
};

export function createOnboardingService(
  options: OnboardingServiceOptions,
): OnboardingService {
  const definitions =
    options.repositories?.definitions ??
    createPostgresOnboardingDefinitionRepository();
  const useCases = createOnboardingUseCases({
    sql: options.sql,
    transactions: options.transactions,
    outbox: options.outbox,
    definitions,
    sessions:
      options.repositories?.sessions ??
      createPostgresOnboardingSessionRepository(),
    stepStates:
      options.repositories?.stepStates ??
      createPostgresOnboardingStepStateRepository(),
    responses:
      options.repositories?.responses ??
      createPostgresOnboardingResponseRepository(),
    suggestions:
      options.repositories?.suggestions ??
      createPostgresOnboardingSuggestionRepository(),
    idempotency:
      options.repositories?.idempotency ??
      createPostgresOnboardingIdempotencyRepository(),
    subjects: createOnboardingSubjectResolverRegistry(
      options.subjectResolvers ?? [],
    ),
    writeTargets: createOnboardingWriteTargetRegistry(
      options.writeTargets ?? [],
    ),
    stepContexts: createOnboardingStepContextRegistry(
      options.stepContextProviders ?? [],
    ),
    logger: options.logger,
  });
  return {
    runtime: {
      startSession: useCases.startSession,
      getCurrentSession: useCases.getCurrentSession,
      getSession: useCases.getSession,
      submitResponse: useCases.submitResponse,
      skipStep: useCases.skipStep,
      goBack: useCases.goBack,
      completeSession: useCases.completeSession,
      resolveSuggestion: useCases.resolveSuggestion,
    },
    internal: {
      bindSessionContext: useCases.bindSessionContext,
      createSuggestion: useCases.createSuggestion,
      expireSuggestion: useCases.expireSuggestion,
    },
    publisher: createOnboardingDefinitionPublisher({
      transactions: options.transactions,
      definitions,
    }),
  };
}
