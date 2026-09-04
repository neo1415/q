import type {
  OnboardingJourneyType,
  OnboardingSessionStatus,
  OnboardingSourceModality,
  OnboardingStepStateStatus,
  OnboardingSuggestionStatus,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

import type {
  OnboardingActor,
  OnboardingDefinition,
  OnboardingDefinitionId,
  OnboardingDefinitionVersion,
  OnboardingDefinitionVersionId,
  OnboardingResponse,
  OnboardingResponseId,
  OnboardingSession,
  OnboardingSessionId,
  OnboardingSourceRef,
  OnboardingStepDefinition,
  OnboardingStepState,
  OnboardingSubject,
  OnboardingSuggestion,
  OnboardingSuggestionId,
  PublishedOnboardingDefinition,
  ValidatedOnboardingResponse,
} from "../contracts/index.js";
import type {
  OnboardingDefinitionManifest,
  OnboardingDefinitionSchemaV1,
  OnboardingWriteTargetKey,
} from "../definitions/schema.js";
import type { OnboardingMutationOperation } from "../domain/idempotency.js";

/**
 * Application-owned ports. Reference reads take an executor; every journey
 * mutation takes the caller's transaction so state, provenance, write-target
 * effects and outbox events commit together or not at all.
 */

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export type OnboardingDefinitionRepository = {
  readonly findByJourney: (
    executor: DatabaseExecutor,
    journeyType: OnboardingJourneyType,
  ) => Promise<OnboardingDefinition | null>;
  /** The full published version (metadata + ordered steps), or null. */
  readonly findPublishedVersionById: (
    executor: DatabaseExecutor,
    versionId: OnboardingDefinitionVersionId,
  ) => Promise<PublishedOnboardingDefinition | null>;
  readonly findVersion: (
    executor: DatabaseExecutor,
    definitionId: OnboardingDefinitionId,
    version: number,
  ) => Promise<OnboardingDefinitionVersion | null>;
  /** Serialises publication per journey. */
  readonly lockJourney: (
    tx: TransactionContext,
    journeyType: OnboardingJourneyType,
  ) => Promise<void>;
  readonly ensureDefinition: (
    tx: TransactionContext,
    input: {
      readonly journeyType: OnboardingJourneyType;
      readonly name: string;
    },
  ) => Promise<OnboardingDefinition>;
  readonly insertPublishedVersion: (
    tx: TransactionContext,
    input: {
      readonly definitionId: OnboardingDefinitionId;
      readonly version: number;
      readonly schema: OnboardingDefinitionSchemaV1;
      readonly manifestHash: string;
      readonly steps: OnboardingDefinitionManifest["steps"];
    },
  ) => Promise<PublishedOnboardingDefinition>;
  readonly setCurrentVersion: (
    tx: TransactionContext,
    definitionId: OnboardingDefinitionId,
    version: number,
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type NewOnboardingSession = {
  readonly userId: UserId;
  readonly tenantId: TenantId | null;
  readonly organisationId: OrganisationId | null;
  readonly journeyType: OnboardingJourneyType;
  readonly definitionVersionId: OnboardingDefinitionVersionId;
  readonly subject: OnboardingSubject | null;
  readonly currentStepKey: string;
};

export type OnboardingSessionUpdate = {
  readonly currentStepKey?: string | null | undefined;
  readonly status?: OnboardingSessionStatus | undefined;
  readonly completedAt?: string | null | undefined;
};

export type OnboardingSessionRepository = {
  /** Internal trusted lookup (suggestion creation / expiry). Never behind a browser route. */
  readonly findById: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
  ) => Promise<OnboardingSession | null>;
  /** Enumeration-safe: only the owner's session is ever returned. */
  readonly findByIdForUser: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
    userId: UserId,
  ) => Promise<OnboardingSession | null>;
  readonly findActive: (
    executor: DatabaseExecutor,
    userId: UserId,
    journeyType: OnboardingJourneyType,
    subject: OnboardingSubject | null,
  ) => Promise<OnboardingSession | null>;
  /** Serialises session creation for a user + journey (+ subject). */
  readonly lockStart: (
    tx: TransactionContext,
    userId: UserId,
    journeyType: OnboardingJourneyType,
    subject: OnboardingSubject | null,
  ) => Promise<void>;
  readonly insert: (
    tx: TransactionContext,
    input: NewOnboardingSession,
  ) => Promise<OnboardingSession>;
  /** Row lock for a mutation; returns the current row or null. */
  readonly lockForUpdate: (
    tx: TransactionContext,
    sessionId: OnboardingSessionId,
    userId: UserId,
  ) => Promise<OnboardingSession | null>;
  /** Applies the update, bumps `version` and `last_activity_at`; expects the given version. */
  readonly commit: (
    tx: TransactionContext,
    sessionId: OnboardingSessionId,
    expectedVersion: number,
    update: OnboardingSessionUpdate,
  ) => Promise<OnboardingSession>;
  /** One-way binding; the database trigger is the second line of defence. */
  readonly bindContext: (
    tx: TransactionContext,
    sessionId: OnboardingSessionId,
    expectedVersion: number,
    binding: {
      readonly tenantId: TenantId;
      readonly organisationId: OrganisationId;
      readonly subject: OnboardingSubject;
    },
  ) => Promise<OnboardingSession>;
};

export type OnboardingStepStateRepository = {
  readonly listBySession: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
  ) => Promise<readonly OnboardingStepState[]>;
  readonly upsert: (
    tx: TransactionContext,
    input: {
      readonly sessionId: OnboardingSessionId;
      readonly stepKey: string;
      readonly status: OnboardingStepStateStatus;
    },
  ) => Promise<OnboardingStepState>;
};

export type OnboardingResponseRepository = {
  /** Current (non-superseded) responses of a session, one per step. */
  readonly listCurrent: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
  ) => Promise<readonly OnboardingResponse[]>;
  readonly listHistory: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
    stepKey: string,
  ) => Promise<readonly OnboardingResponse[]>;
  readonly findById: (
    executor: DatabaseExecutor,
    responseId: OnboardingResponseId,
  ) => Promise<OnboardingResponse | null>;
  /** The id is chosen by the runtime so the old row can link forward first. */
  readonly insert: (
    tx: TransactionContext,
    input: {
      readonly responseId: OnboardingResponseId;
      readonly sessionId: OnboardingSessionId;
      readonly response: ValidatedOnboardingResponse;
    },
  ) => Promise<OnboardingResponse>;
  /** Links the old current response forward. Never touches its content. */
  readonly supersede: (
    tx: TransactionContext,
    previousResponseId: OnboardingResponseId,
    replacementResponseId: OnboardingResponseId,
  ) => Promise<void>;
};

export type NewOnboardingSuggestion = {
  readonly sessionId: OnboardingSessionId;
  readonly stepKey: string;
  readonly targetField: string;
  readonly suggestedValue: OnboardingSuggestion["suggestedValue"];
  readonly sourceRefs: readonly OnboardingSourceRef[];
  readonly confidence: string | null;
  readonly modelRunId: string | null;
};

export type OnboardingSuggestionRepository = {
  readonly listPending: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
  ) => Promise<readonly OnboardingSuggestion[]>;
  readonly findById: (
    executor: DatabaseExecutor,
    sessionId: OnboardingSessionId,
    suggestionId: OnboardingSuggestionId,
  ) => Promise<OnboardingSuggestion | null>;
  readonly insert: (
    tx: TransactionContext,
    input: NewOnboardingSuggestion,
  ) => Promise<OnboardingSuggestion>;
  /** PENDING -> terminal status; returns false if it was already resolved. */
  readonly resolve: (
    tx: TransactionContext,
    suggestionId: OnboardingSuggestionId,
    status: Exclude<OnboardingSuggestionStatus, "PENDING">,
  ) => Promise<boolean>;
};

/** Hash-only idempotency for session start and session mutations. */
export type OnboardingIdempotencyRepository = {
  readonly lockStart: (
    tx: TransactionContext,
    userId: UserId,
    journeyType: OnboardingJourneyType,
    keyHash: string,
  ) => Promise<void>;
  readonly findStart: (
    tx: TransactionContext,
    userId: UserId,
    journeyType: OnboardingJourneyType,
    keyHash: string,
  ) => Promise<{
    readonly requestHash: string;
    readonly sessionId: OnboardingSessionId;
  } | null>;
  readonly recordStart: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly journeyType: OnboardingJourneyType;
      readonly keyHash: string;
      readonly requestHash: string;
      readonly sessionId: OnboardingSessionId;
    },
  ) => Promise<void>;
  readonly findMutation: (
    tx: TransactionContext,
    sessionId: OnboardingSessionId,
    keyHash: string,
  ) => Promise<{
    readonly operation: OnboardingMutationOperation;
    readonly requestHash: string;
    readonly resultVersion: number;
  } | null>;
  readonly recordMutation: (
    tx: TransactionContext,
    input: {
      readonly sessionId: OnboardingSessionId;
      readonly keyHash: string;
      readonly operation: OnboardingMutationOperation;
      readonly requestHash: string;
      readonly resultVersion: number;
    },
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Subject resolution and write targets
// ---------------------------------------------------------------------------

/**
 * Resolves a canonical subject through its owning domain's public port
 * under the actor's context. Trusted ownership facts only; never a table.
 */
export type OnboardingSubjectResolver = {
  readonly subjectType: OnboardingSubject["subjectType"];
  readonly resolve: (
    context: ActorContext,
    subjectId: string,
  ) => Promise<{
    readonly tenantId: TenantId;
    readonly organisationId: OrganisationId;
  } | null>;
};

export type OnboardingWriteContext = {
  readonly tx: TransactionContext;
  readonly actor: OnboardingActor;
  readonly session: OnboardingSession;
  readonly step: OnboardingStepDefinition;
  readonly correlationId: string;
  /** Responses on the current path before this one is applied. */
  readonly currentResponses: ReadonlyMap<string, OnboardingResponse>;
};

/**
 * A domain's adapter for one semantic target key. It runs inside the
 * onboarding transaction: a failure rolls back the response, the step
 * state and every event. It never opens its own transaction and it never
 * receives raw SQL authority from the runtime.
 */
export type OnboardingWriteTargetHandler = {
  readonly targetKey: OnboardingWriteTargetKey;
  readonly apply: (
    context: OnboardingWriteContext,
    response: ValidatedOnboardingResponse,
  ) => Promise<void>;
};

export type OnboardingWriteTargetRegistry = {
  readonly get: (
    targetKey: OnboardingWriteTargetKey,
  ) => OnboardingWriteTargetHandler | undefined;
  readonly keys: () => readonly OnboardingWriteTargetKey[];
};

export type OnboardingSubjectResolverRegistry = {
  readonly get: (
    subjectType: OnboardingSubject["subjectType"],
  ) => OnboardingSubjectResolver | undefined;
};

export type { OnboardingSourceModality };
