import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CorrelationIdSchema,
  OnboardingJourneyTypeSchema,
  OnboardingQuestionOptionViewSchema,
  OnboardingQuestionReasonSchema,
  OnboardingResponseValueSchema,
  OnboardingStepKeySchema,
  OnboardingSubjectTypeSchema,
  OnboardingSuggestionResolutionSchema,
  UuidSchema,
  type CorrelationId,
  type OnboardingJourneyType,
  type OnboardingPathChanges,
  type OnboardingSessionView,
  type OnboardingUnderstanding,
  type OnboardingSuggestionResolution,
  type OnboardingResponseValue,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { Logger } from "@capital-q/observability";
import {
  ActorContextSchema,
  AuthenticatedPrincipalSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  OnboardingInterviewQuestionIdSchema,
  OnboardingResponseIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSourceRefsSchema,
  OnboardingSuggestionConfidenceSchema,
  OnboardingSuggestionIdSchema,
  type OnboardingActor,
  type OnboardingInterviewQuestion,
  type OnboardingInterviewQuestionId,
  type OnboardingResponse,
  type OnboardingSession,
  type OnboardingSessionId,
  type OnboardingStepDefinition,
  type OnboardingSubject,
  type OnboardingSuggestion,
  type OnboardingSuggestionId,
  type ValidatedOnboardingResponse,
} from "../contracts/index.js";
import {
  OnboardingContextRequiredError,
  OnboardingDefinitionUnavailableError,
  OnboardingInterviewQuestionNotFoundError,
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  OnboardingSessionStateError,
  OnboardingSessionVersionConflictError,
  OnboardingSubjectNotFoundError,
  OnboardingSuggestionNotFoundError,
} from "../domain/errors.js";
import {
  hashOnboardingIdempotencyKey,
  hashOnboardingRequest,
  type OnboardingMutationOperation,
} from "../domain/idempotency.js";
import {
  responseCommittedEvent,
  sessionCompletedEvent,
  sessionStartedEvent,
  stepSkippedEvent,
  suggestionResolvedEvent,
} from "../events/index.js";
import {
  computeActivePath,
  nextIncompleteStep,
  pathChanges,
  previousVisitedStep,
  requiredStepsComplete,
} from "../runtime/path.js";
import { validateOnboardingResponse } from "../runtime/validate-response.js";
import { getOnboardingMetrics } from "./metrics.js";
import type {
  OnboardingDefinitionRepository,
  OnboardingIdempotencyRepository,
  OnboardingInterviewQuestionRepository,
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingStepContextRegistry,
  OnboardingStepStateRepository,
  OnboardingSubjectResolverRegistry,
  OnboardingSuggestionRepository,
  OnboardingUtteranceRepository,
  OnboardingWriteContext,
  OnboardingWriteTargetRegistry,
  OnboardingTaxonomyResolver,
} from "./ports.js";
import {
  interpretUtterance,
  isRichUtterance,
  type OnboardingUtteranceAliases,
} from "../domain/interpretation.js";
import { correctionIntent } from "../domain/resolution/correction.js";
import {
  resolveAcrossSteps,
  type InterviewCues,
} from "../domain/resolution/cross-step.js";
import {
  aggregateTaxonomyCandidates,
  taxonomyPhrases,
} from "../domain/resolution/taxonomy-phrases.js";
import { wordsOf } from "../domain/text.js";
import { utteranceRecordedEvent } from "../events/index.js";
import {
  createDefinitionCache,
  loadAggregate,
  toSessionView,
  type OnboardingSessionAggregate,
  presentationOf,
} from "./view.js";

/**
 * Onboarding runtime use cases.
 *
 * Every mutation: row-lock the owner's session -> idempotency replay ->
 * ACTIVE check -> expectedSessionVersion (VERSION_CONFLICT otherwise) ->
 * validate against the pinned definition and current path -> registered
 * write targets inside the same transaction -> journey state -> version++
 * -> outbox -> commit. Session ownership is the user id; an organisation
 * admin gets nothing from another person's raw journey. Nothing here
 * knows a Founder step from an Investor step.
 */

export type OnboardingRuntimeDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly outbox: OutboxWriter;
  readonly definitions: OnboardingDefinitionRepository;
  readonly sessions: OnboardingSessionRepository;
  readonly stepStates: OnboardingStepStateRepository;
  readonly responses: OnboardingResponseRepository;
  readonly suggestions: OnboardingSuggestionRepository;
  /** Optional so older compositions keep working; absent disables questions. */
  readonly questions?: OnboardingInterviewQuestionRepository | undefined;
  /** Optional; absent means a free-text turn Q would read is refused, never dropped. */
  readonly utterances?: OnboardingUtteranceRepository | undefined;
  /** Journey-supplied plain-language names for options (CQ-PRE-REC-001 §19). */
  readonly utteranceAliases?: OnboardingUtteranceAliases | undefined;
  /** Where a journey's figures and exclusions live (CQ-Q-VOICE-001 A §8, §12). */
  readonly interviewCues?: InterviewCues | undefined;
  /** Capital Q's taxonomy classifier, for category phrases in a sentence (§5, §10-§11). */
  readonly taxonomy?: OnboardingTaxonomyResolver | undefined;
  readonly idempotency: OnboardingIdempotencyRepository;
  readonly subjects: OnboardingSubjectResolverRegistry;
  readonly writeTargets: OnboardingWriteTargetRegistry;
  readonly stepContexts: OnboardingStepContextRegistry;
  readonly logger?: Logger | undefined;
};

const ActorSchema = z
  .object({
    userId: UserIdSchema,
    context: ActorContextSchema.nullable(),
    principal: AuthenticatedPrincipalSchema.optional(),
  })
  .strict();
const SubjectSchema = z
  .object({ subjectType: OnboardingSubjectTypeSchema, subjectId: UuidSchema })
  .strict();
const IdempotencyKeySchema = z.string().min(1).max(255);
const VersionSchema = z.number().int().min(1);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type StartOnboardingSessionCommand = {
  readonly actor: OnboardingActor;
  readonly journeyType: OnboardingJourneyType;
  readonly subject?: OnboardingSubject | undefined;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type StartOnboardingSessionResult = {
  readonly view: OnboardingSessionView;
  /** False when an existing ACTIVE session was resumed or an idempotent replay answered. */
  readonly created: boolean;
};

export type SayOnboardingCommand = {
  readonly actor: OnboardingActor;
  readonly sessionId: OnboardingSessionId;
  readonly text: string;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type SayOnboardingOutcome = {
  readonly view: OnboardingSessionView;
  readonly understood: OnboardingUnderstanding;
};

export type SessionScopedQuery = {
  readonly actor: OnboardingActor;
  readonly sessionId: OnboardingSessionId;
};

export type CurrentSessionQuery = {
  readonly actor: OnboardingActor;
  readonly journeyType: OnboardingJourneyType;
};

export type BindSessionContextCommand = SessionScopedQuery & {
  readonly subject: OnboardingSubject;
};

export type SubmitOnboardingResponseCommand = SessionScopedQuery & {
  readonly stepKey: string;
  /** Validated here against the pinned step; typed as unknown at this boundary. */
  readonly response: unknown;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type SkipOnboardingStepCommand = SessionScopedQuery & {
  readonly stepKey: string;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type OnboardingBackCommand = SessionScopedQuery & {
  readonly expectedSessionVersion: number;
  readonly targetStepKey?: string | undefined;
};

export type CompleteOnboardingSessionCommand = SessionScopedQuery & {
  readonly expectedSessionVersion: number;
  readonly correlationId: CorrelationId;
};

export type ResolveOnboardingSuggestionCommand = SessionScopedQuery & {
  readonly suggestionId: OnboardingSuggestionId;
  readonly resolution: OnboardingSuggestionResolution;
  readonly response?: unknown;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/** Internal trusted operation (future Q). Never reachable from the browser. */
export type CreateOnboardingSuggestionCommand = {
  readonly sessionId: OnboardingSessionId;
  readonly stepKey: string;
  readonly targetField: string;
  readonly suggestedValue: unknown;
  readonly sourceRefs?:
    readonly { sourceType: string; sourceId: string }[] | undefined;
  readonly confidence?: string | null | undefined;
  readonly modelRunId?: string | null | undefined;
};

/** Internal trusted operation: what a planner decided is worth asking. Never browser-reachable. */
export type RecordOnboardingQuestionsCommand = {
  readonly sessionId: OnboardingSessionId;
  readonly questions: readonly {
    readonly stepKey: string;
    readonly factKey: string;
    readonly question: string;
    readonly why?: string | null | undefined;
    readonly reason: string;
    readonly readings?: readonly string[] | undefined;
    readonly options?:
      readonly { label: string; stepKey: string; value: unknown }[] | undefined;
    readonly sourceRefs?:
      readonly { sourceType: string; sourceId: string }[] | undefined;
  }[];
};

export type AnswerOnboardingQuestionCommand = SessionScopedQuery & {
  readonly questionId: OnboardingInterviewQuestionId;
  readonly stepKey: string;
  readonly response: unknown;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type DismissOnboardingQuestionCommand = SessionScopedQuery & {
  readonly questionId: OnboardingInterviewQuestionId;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type ExpireOnboardingSuggestionCommand = {
  readonly sessionId: OnboardingSessionId;
  readonly suggestionId: OnboardingSuggestionId;
  readonly correlationId: CorrelationId;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Runtime = OnboardingRuntimeDependencies & {
  readonly loadDefinition: ReturnType<typeof createDefinitionCache>;
};

function aggregateOf(
  runtime: Runtime,
  executor: DatabaseExecutor,
  session: OnboardingSession,
) {
  return loadAggregate(executor, runtime, runtime.loadDefinition, session);
}

async function ownedSession(
  runtime: Runtime,
  executor: DatabaseExecutor,
  actor: OnboardingActor,
  sessionId: OnboardingSessionId,
): Promise<OnboardingSession> {
  const session = await runtime.sessions.findByIdForUser(
    executor,
    sessionId,
    actor.userId,
  );
  if (session === null) {
    throw new OnboardingSessionNotFoundError();
  }
  return session;
}

async function lockedActiveSession(
  runtime: Runtime,
  tx: TransactionContext,
  actor: OnboardingActor,
  sessionId: OnboardingSessionId,
  expectedVersion: number,
): Promise<OnboardingSession> {
  const session = await runtime.sessions.lockForUpdate(
    tx,
    sessionId,
    actor.userId,
  );
  if (session === null) {
    throw new OnboardingSessionNotFoundError();
  }
  if (session.status !== "ACTIVE") {
    throw new OnboardingSessionStateError("SESSION_NOT_ACTIVE");
  }
  if (session.version !== expectedVersion) {
    throw new OnboardingSessionVersionConflictError();
  }
  return session;
}

/** Replays an identical mutation; conflicts on a reused key with another payload. */
async function replayOrRecordable(
  runtime: Runtime,
  tx: TransactionContext,
  session: OnboardingSession,
  operation: OnboardingMutationOperation,
  idempotencyKey: string,
  request: unknown,
): Promise<{
  readonly keyHash: string;
  readonly requestHash: string;
  readonly replay: boolean;
}> {
  const keyHash = hashOnboardingIdempotencyKey(operation, idempotencyKey);
  const requestHash = hashOnboardingRequest(request);
  const previous = await runtime.idempotency.findMutation(
    tx,
    session.id,
    keyHash,
  );
  if (previous === null) {
    return { keyHash, requestHash, replay: false };
  }
  if (
    previous.operation !== operation ||
    previous.requestHash !== requestHash
  ) {
    throw new OnboardingMutationConflictError();
  }
  return { keyHash, requestHash, replay: true };
}

function eligibleStep(
  aggregate: OnboardingSessionAggregate,
  stepKey: string,
): OnboardingStepDefinition {
  const step = aggregate.stepsByKey.get(stepKey);
  if (step === undefined || !aggregate.path.eligibleKeys.has(stepKey)) {
    throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
  }
  return step;
}

/**
 * The atomic response commit shared by submit and suggestion resolution:
 * write targets -> insert -> supersede -> COMPLETED -> recompute path ->
 * next current step -> version++. Caller emits the events it owns.
 */
async function commitResponse(
  runtime: Runtime,
  tx: TransactionContext,
  actor: OnboardingActor,
  aggregate: OnboardingSessionAggregate,
  step: OnboardingStepDefinition,
  validated: ValidatedOnboardingResponse,
  correlationId: CorrelationId,
  options: {
    /** The proposal being accepted or corrected by this very commit. */
    readonly resolvingSuggestionId?: OnboardingSuggestionId | undefined;
  } = {},
): Promise<{
  readonly session: OnboardingSession;
  readonly response: OnboardingResponse;
  readonly changes: OnboardingPathChanges;
}> {
  // Handlers may bind the session's canonical context in this transaction
  // (F1-style bootstrap); the commit below expects the version they left.
  let currentSession = aggregate.session;
  const bindContext: OnboardingWriteContext["bindContext"] = async (
    binding,
  ) => {
    const s = currentSession;
    if (s.subject !== null) {
      if (
        s.subject.subjectType === binding.subject.subjectType &&
        s.subject.subjectId === binding.subject.subjectId
      ) {
        return s;
      }
      throw new OnboardingSessionStateError("SUBJECT_ALREADY_BOUND");
    }
    if (
      (s.tenantId !== null && s.tenantId !== binding.tenantId) ||
      (s.organisationId !== null && s.organisationId !== binding.organisationId)
    ) {
      throw new OnboardingSessionStateError("CONTEXT_ALREADY_BOUND");
    }
    currentSession = await runtime.sessions.bindContext(
      tx,
      s.id,
      s.version,
      binding,
    );
    return currentSession;
  };
  // Every target must have a handler before anything is written: a step
  // that declares a target nobody registered fails safely and completely.
  const handlers = step.writesTo.map((target) => {
    const handler = runtime.writeTargets.get(target.targetKey);
    if (handler === undefined) {
      throw new OnboardingRuntimeConfigurationError(
        "WRITE_TARGET_HANDLER_MISSING",
        `step ${step.stepKey} writes to ${target.targetKey}`,
      );
    }
    return handler;
  });
  for (const handler of handlers) {
    await handler.apply(
      {
        tx,
        actor,
        session: currentSession,
        step,
        correlationId,
        currentResponses: aggregate.currentResponses,
        bindContext,
      },
      validated,
    );
  }

  // The old row links forward first (deferred FK), then the replacement is
  // inserted: one current response per step at every statement boundary.
  const responseId = OnboardingResponseIdSchema.parse(randomUUID());
  const previous = aggregate.currentResponses.get(step.stepKey);
  if (previous !== undefined) {
    await runtime.responses.supersede(tx, previous.id, responseId);
  }
  const response = await runtime.responses.insert(tx, {
    responseId,
    sessionId: aggregate.session.id,
    response: validated,
  });
  await runtime.stepStates.upsert(tx, {
    sessionId: aggregate.session.id,
    stepKey: step.stepKey,
    status: "COMPLETED",
  });

  // The person has answered this step; any other proposal still pending for
  // it would now be an offer to overwrite that answer. Retired, not applied.
  for (const stale of aggregate.pendingSuggestions) {
    if (
      stale.stepKey !== step.stepKey ||
      stale.id === options.resolvingSuggestionId
    ) {
      continue;
    }
    if (await runtime.suggestions.resolve(tx, stale.id, "EXPIRED")) {
      await runtime.outbox.enqueue(
        tx,
        suggestionResolvedEvent({
          session: currentSession,
          correlationId,
          suggestionId: stale.id,
          stepKey: step.stepKey,
          resolution: "EXPIRED",
        }),
      );
    }
  }

  const responsesAfter = new Map(aggregate.currentResponses);
  responsesAfter.set(step.stepKey, response);
  const statesAfter = await runtime.stepStates.listBySession(
    tx.sql,
    aggregate.session.id,
  );
  const states = new Map(statesAfter.map((s) => [s.stepKey, s]));
  const pathAfter = computeActivePath(
    aggregate.definition.steps,
    responsesAfter,
  );
  const changes = pathChanges(
    aggregate.path.eligibleKeys,
    pathAfter.eligibleKeys,
  );

  const next = nextIncompleteStep(pathAfter, states);
  if (next !== null && !states.has(next.stepKey)) {
    await runtime.stepStates.upsert(tx, {
      sessionId: aggregate.session.id,
      stepKey: next.stepKey,
      status: "IN_PROGRESS",
    });
  }
  const session = await runtime.sessions.commit(
    tx,
    aggregate.session.id,
    currentSession.version,
    { currentStepKey: next?.stepKey ?? step.stepKey },
  );
  return { session, response, changes };
}

function safeLog(
  runtime: Runtime,
  operation: string,
  session: OnboardingSession,
  extra: Readonly<Record<string, string | number | boolean>> = {},
) {
  runtime.logger?.info(
    {
      operation,
      sessionId: session.id,
      journeyType: session.journeyType,
      definitionVersionId: session.definitionVersionId,
      sessionVersion: session.version,
      ...extra,
    },
    "onboarding runtime operation",
  );
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

export function createOnboardingUseCases(
  dependencies: OnboardingRuntimeDependencies,
) {
  const runtime: Runtime = {
    ...dependencies,
    loadDefinition: createDefinitionCache(dependencies.definitions),
  };
  const {
    sql,
    transactions,
    outbox,
    sessions,
    stepStates,
    suggestions,
    idempotency,
  } = runtime;

  // The session view, with the current step's server-side context when the
  // pinned definition names a provider for it.
  const view = async (
    executor: DatabaseExecutor,
    actor: OnboardingActor,
    session: OnboardingSession,
    changes?: OnboardingPathChanges,
  ) => {
    const aggregate = await aggregateOf(runtime, executor, session);
    const current =
      session.currentStepKey === null
        ? undefined
        : aggregate.stepsByKey.get(session.currentStepKey);
    let context: Readonly<Record<string, unknown>> | undefined;
    if (
      current !== undefined &&
      (current.configuration.stepType === "confirmation" ||
        current.configuration.stepType === "reference_select") &&
      current.configuration.contextKey !== undefined &&
      aggregate.path.eligibleKeys.has(current.stepKey)
    ) {
      const provider = runtime.stepContexts.get(
        current.configuration.contextKey,
      );
      if (provider === undefined) {
        throw new OnboardingRuntimeConfigurationError(
          "STEP_CONTEXT_PROVIDER_MISSING",
          `step ${current.stepKey} needs ${current.configuration.contextKey}`,
        );
      }
      context = await provider.load({
        executor,
        actor,
        session,
        step: current,
        currentResponses: aggregate.currentResponses,
      });
    }
    return toSessionView(aggregate, changes, context);
  };

  const publishedForJourney = async (journeyType: OnboardingJourneyType) => {
    const definition = await runtime.definitions.findByJourney(
      sql,
      journeyType,
    );
    if (
      definition === null ||
      definition.status !== "ACTIVE" ||
      definition.currentVersion === null
    ) {
      throw new OnboardingDefinitionUnavailableError();
    }
    const version = await runtime.definitions.findVersion(
      sql,
      definition.id,
      definition.currentVersion,
    );
    if (version === null || version.publishedAt === null) {
      throw new OnboardingDefinitionUnavailableError();
    }
    return runtime.loadDefinition(sql, version.id);
  };

  const resolveSubject = async (
    context: ActorContext | null,
    subject: OnboardingSubject,
    expectedType: OnboardingSubject["subjectType"],
  ) => {
    if (subject.subjectType !== expectedType) {
      throw new OnboardingSessionStateError("SUBJECT_TYPE_MISMATCH");
    }
    if (context === null || context.organisationId === undefined) {
      throw new OnboardingContextRequiredError();
    }
    const resolver = runtime.subjects.get(subject.subjectType);
    if (resolver === undefined) {
      throw new OnboardingRuntimeConfigurationError(
        "SUBJECT_RESOLVER_MISSING",
        `no resolver for ${subject.subjectType}`,
      );
    }
    const ownership = await resolver.resolve(context, subject.subjectId);
    // Owned elsewhere or absent: the same answer, so nothing is enumerable.
    if (
      ownership === null ||
      ownership.tenantId !== context.tenantId ||
      ownership.organisationId !== context.organisationId
    ) {
      throw new OnboardingSubjectNotFoundError();
    }
    return ownership;
  };

  const startSession = async (
    raw: StartOnboardingSessionCommand,
  ): Promise<StartOnboardingSessionResult> => {
    const command = z
      .object({
        actor: ActorSchema,
        journeyType: OnboardingJourneyTypeSchema,
        subject: SubjectSchema.optional(),
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor, journeyType } = command;
    const published = await publishedForJourney(journeyType);
    const settings = published.version.schema.runtime;
    const subject = command.subject ?? null;
    const firstStep = computeActivePath(published.steps, new Map()).eligible[0];
    if (firstStep === undefined) {
      throw new OnboardingRuntimeConfigurationError(
        "DEFINITION_STEP_MISSING",
        `journey ${journeyType} has no eligible first step`,
      );
    }
    const keyHash = hashOnboardingIdempotencyKey(
      "start",
      command.idempotencyKey,
    );
    const requestHash = hashOnboardingRequest({ journeyType, subject });

    return transactions.run(async (tx) => {
      await idempotency.lockStart(tx, actor.userId, journeyType, keyHash);
      const previous = await idempotency.findStart(
        tx,
        actor.userId,
        journeyType,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new OnboardingMutationConflictError();
        }
        const replayed = await ownedSession(
          runtime,
          tx.sql,
          actor,
          previous.sessionId,
        );
        return { view: await view(tx.sql, actor, replayed), created: false };
      }
      const ownership =
        subject === null
          ? null
          : await resolveSubject(actor.context, subject, settings.subjectType);
      if (subject === null && !settings.allowUnboundStart) {
        throw new OnboardingSessionStateError("UNBOUND_START_NOT_ALLOWED");
      }
      await sessions.lockStart(tx, actor.userId, journeyType, subject);
      // An unbound start resumes the person's latest active session of the
      // journey even after it bound its subject: a founder returning without
      // a company id must land on the same session, never a second company.
      const existing =
        subject === null
          ? await sessions.findLatestActive(tx.sql, actor.userId, journeyType)
          : await sessions.findActive(
              tx.sql,
              actor.userId,
              journeyType,
              subject,
            );
      if (existing !== null) {
        safeLog(runtime, "session.resumed", existing);
        return { view: await view(tx.sql, actor, existing), created: false };
      }
      const session = await sessions.insert(tx, {
        userId: actor.userId,
        tenantId: ownership?.tenantId ?? null,
        organisationId: ownership?.organisationId ?? null,
        journeyType,
        definitionVersionId: published.version.id,
        subject,
        currentStepKey: firstStep.stepKey,
      });
      await stepStates.upsert(tx, {
        sessionId: session.id,
        stepKey: firstStep.stepKey,
        status: "IN_PROGRESS",
      });
      await idempotency.recordStart(tx, {
        userId: actor.userId,
        journeyType,
        keyHash,
        requestHash,
        sessionId: session.id,
      });
      await outbox.enqueue(
        tx,
        sessionStartedEvent({ session, correlationId: command.correlationId }),
      );
      getOnboardingMetrics().sessionsStarted.add(1, {
        journeyType,
        bound: subject !== null,
      });
      safeLog(runtime, "session.started", session);
      return { view: await view(tx.sql, actor, session), created: true };
    });
  };

  /** The caller's latest session of a journey (active or completed), or null. */
  const getCurrentSession = async (
    raw: CurrentSessionQuery,
  ): Promise<OnboardingSessionView | null> => {
    const query = z
      .object({ actor: ActorSchema, journeyType: OnboardingJourneyTypeSchema })
      .strict()
      .parse(raw);
    const session = await runtime.sessions.findLatest(
      sql,
      query.actor.userId,
      query.journeyType,
    );
    return session === null ? null : view(sql, query.actor, session);
  };

  const getSession = async (
    query: SessionScopedQuery,
  ): Promise<OnboardingSessionView> => {
    const session = await ownedSession(
      runtime,
      sql,
      query.actor,
      OnboardingSessionIdSchema.parse(query.sessionId),
    );
    return view(sql, query.actor, session);
  };

  const bindSessionContext = async (
    raw: BindSessionContextCommand,
  ): Promise<OnboardingSession> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        subject: SubjectSchema,
      })
      .strict()
      .parse(raw);
    const { actor, subject } = command;
    return transactions.run(async (tx) => {
      const session = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (session === null) {
        throw new OnboardingSessionNotFoundError();
      }
      if (session.status !== "ACTIVE") {
        throw new OnboardingSessionStateError("SESSION_NOT_ACTIVE");
      }
      const published = await runtime.loadDefinition(
        tx.sql,
        session.definitionVersionId,
      );
      const ownership = await resolveSubject(
        actor.context,
        subject,
        published.version.schema.runtime.subjectType,
      );
      if (session.subject !== null) {
        if (
          session.subject.subjectType === subject.subjectType &&
          session.subject.subjectId === subject.subjectId
        ) {
          return session;
        }
        throw new OnboardingSessionStateError("SUBJECT_ALREADY_BOUND");
      }
      if (
        (session.tenantId !== null &&
          session.tenantId !== ownership.tenantId) ||
        (session.organisationId !== null &&
          session.organisationId !== ownership.organisationId)
      ) {
        throw new OnboardingSessionStateError("CONTEXT_ALREADY_BOUND");
      }
      const bound = await sessions.bindContext(
        tx,
        session.id,
        session.version,
        {
          tenantId: ownership.tenantId,
          organisationId: ownership.organisationId,
          subject,
        },
      );
      safeLog(runtime, "session.context_bound", bound, {
        subjectType: subject.subjectType,
      });
      return bound;
    });
  };

  const submitResponse = async (
    raw: SubmitOnboardingResponseCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        stepKey: OnboardingStepKeySchema,
        response: z.unknown(),
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    return transactions.run(async (tx) => {
      const locked = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (locked === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const idem = await replayOrRecordable(
        runtime,
        tx,
        locked,
        "submit",
        command.idempotencyKey,
        {
          stepKey: command.stepKey,
          response: command.response,
          expectedSessionVersion: command.expectedSessionVersion,
        },
      );
      if (idem.replay) {
        return view(tx.sql, actor, locked);
      }
      const session = await lockedActiveSession(
        runtime,
        tx,
        actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      const step = eligibleStep(aggregate, command.stepKey);
      const validated = validateOnboardingResponse(step, command.response);
      const committed = await commitResponse(
        runtime,
        tx,
        actor,
        aggregate,
        step,
        validated,
        command.correlationId,
      );
      await idempotency.recordMutation(tx, {
        sessionId: session.id,
        keyHash: idem.keyHash,
        operation: "submit",
        requestHash: idem.requestHash,
        resultVersion: committed.session.version,
      });
      await outbox.enqueue(
        tx,
        responseCommittedEvent({
          session: committed.session,
          correlationId: command.correlationId,
          stepKey: step.stepKey,
          responseId: committed.response.id,
        }),
      );
      getOnboardingMetrics().responsesCommitted.add(1, {
        journeyType: session.journeyType,
        stepType: step.stepType,
      });
      safeLog(runtime, "response.committed", committed.session, {
        stepKey: step.stepKey,
      });
      return view(tx.sql, actor, committed.session, committed.changes);
    });
  };

  const skipStep = async (
    raw: SkipOnboardingStepCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        stepKey: OnboardingStepKeySchema,
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    return transactions.run(async (tx) => {
      const locked = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (locked === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const idem = await replayOrRecordable(
        runtime,
        tx,
        locked,
        "skip",
        command.idempotencyKey,
        {
          stepKey: command.stepKey,
          expectedSessionVersion: command.expectedSessionVersion,
        },
      );
      if (idem.replay) {
        return view(tx.sql, actor, locked);
      }
      const session = await lockedActiveSession(
        runtime,
        tx,
        actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      const step = eligibleStep(aggregate, command.stepKey);
      if (step.required) {
        throw new OnboardingSessionStateError("STEP_REQUIRED");
      }
      if (aggregate.states.get(step.stepKey)?.status === "COMPLETED") {
        throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
      }
      // No fake answer: skipped stays unknown, and branching treats it as absent.
      await stepStates.upsert(tx, {
        sessionId: session.id,
        stepKey: step.stepKey,
        status: "SKIPPED",
      });
      const states = new Map(
        (await stepStates.listBySession(tx.sql, session.id)).map((s) => [
          s.stepKey,
          s,
        ]),
      );
      const next = nextIncompleteStep(aggregate.path, states);
      if (next !== null && !states.has(next.stepKey)) {
        await stepStates.upsert(tx, {
          sessionId: session.id,
          stepKey: next.stepKey,
          status: "IN_PROGRESS",
        });
      }
      const updated = await sessions.commit(tx, session.id, session.version, {
        currentStepKey: next?.stepKey ?? step.stepKey,
      });
      await idempotency.recordMutation(tx, {
        sessionId: session.id,
        keyHash: idem.keyHash,
        operation: "skip",
        requestHash: idem.requestHash,
        resultVersion: updated.version,
      });
      await outbox.enqueue(
        tx,
        stepSkippedEvent({
          session: updated,
          correlationId: command.correlationId,
          stepKey: step.stepKey,
        }),
      );
      getOnboardingMetrics().stepsSkipped.add(1, {
        journeyType: session.journeyType,
      });
      safeLog(runtime, "step.skipped", updated, { stepKey: step.stepKey });
      return view(tx.sql, actor, updated);
    });
  };

  const goBack = async (
    raw: OnboardingBackCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        expectedSessionVersion: VersionSchema,
        targetStepKey: OnboardingStepKeySchema.optional(),
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    return transactions.run(async (tx) => {
      const session = await lockedActiveSession(
        runtime,
        tx,
        command.actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      const currentIndex = aggregate.path.eligible.findIndex(
        (s) => s.stepKey === session.currentStepKey,
      );
      let target: OnboardingStepDefinition | null;
      if (command.targetStepKey === undefined) {
        target = previousVisitedStep(
          aggregate.path,
          aggregate.states,
          session.currentStepKey,
        );
        if (target === null) {
          throw new OnboardingSessionStateError("NO_PREVIOUS_STEP");
        }
      } else {
        const index = aggregate.path.eligible.findIndex(
          (s) => s.stepKey === command.targetStepKey,
        );
        const candidate =
          index >= 0 ? aggregate.path.eligible[index] : undefined;
        // Any visited, currently eligible step -- earlier to revise, or later
        // to return after revising. Never an unvisited (locked) future step.
        if (
          candidate === undefined ||
          index === currentIndex ||
          !aggregate.states.has(candidate.stepKey)
        ) {
          throw new OnboardingSessionStateError("STEP_NOT_VISITED");
        }
        target = candidate;
      }
      // Navigation only: responses, states and canonical data stay as they are.
      const updated = await sessions.commit(tx, session.id, session.version, {
        currentStepKey: target.stepKey,
      });
      safeLog(runtime, "session.back", updated, { stepKey: target.stepKey });
      return view(tx.sql, actor, updated);
    });
  };

  const completeSession = async (
    raw: CompleteOnboardingSessionCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        expectedSessionVersion: VersionSchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    return transactions.run(async (tx) => {
      const session = await lockedActiveSession(
        runtime,
        tx,
        command.actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      if (!requiredStepsComplete(aggregate.path, aggregate.states)) {
        throw new OnboardingSessionStateError("REQUIRED_STEPS_INCOMPLETE");
      }
      // Completion is journey completion only: not visibility, readiness or verification.
      const updated = await sessions.commit(tx, session.id, session.version, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        currentStepKey: null,
      });
      await outbox.enqueue(
        tx,
        sessionCompletedEvent({
          session: updated,
          correlationId: command.correlationId,
        }),
      );
      getOnboardingMetrics().sessionsCompleted.add(1, {
        journeyType: session.journeyType,
      });
      safeLog(runtime, "session.completed", updated);
      return view(tx.sql, actor, updated);
    });
  };

  const createSuggestion = async (
    raw: CreateOnboardingSuggestionCommand,
  ): Promise<OnboardingSuggestion> => {
    const command = z
      .object({
        sessionId: OnboardingSessionIdSchema,
        stepKey: OnboardingStepKeySchema,
        targetField: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/),
        suggestedValue: OnboardingResponseValueSchema,
        sourceRefs: OnboardingSourceRefsSchema.default([]),
        confidence:
          OnboardingSuggestionConfidenceSchema.nullable().default(null),
        modelRunId: UuidSchema.nullable().default(null),
      })
      .strict()
      .parse(raw);
    return transactions.run(async (tx) => {
      const session = await sessions.findById(tx.sql, command.sessionId);
      if (session === null || session.status !== "ACTIVE") {
        throw new OnboardingSessionNotFoundError();
      }
      const published = await runtime.loadDefinition(
        tx.sql,
        session.definitionVersionId,
      );
      const step = published.steps.find((s) => s.stepKey === command.stepKey);
      if (step === undefined) {
        throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
      }
      // A suggestion must already be a valid answer to the pinned step.
      validateOnboardingResponse(
        step,
        { value: command.suggestedValue },
        { sourceModality: "SUGGESTION_ACCEPT" },
      );
      return suggestions.insert(tx, {
        sessionId: session.id,
        stepKey: step.stepKey,
        targetField: command.targetField,
        suggestedValue: command.suggestedValue,
        sourceRefs: command.sourceRefs,
        confidence: command.confidence,
        modelRunId: command.modelRunId,
      });
    });
  };

  const resolveSuggestion = async (
    raw: ResolveOnboardingSuggestionCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        suggestionId: OnboardingSuggestionIdSchema,
        resolution: OnboardingSuggestionResolutionSchema,
        response: z.unknown().optional(),
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    return transactions.run(async (tx) => {
      const locked = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (locked === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const idem = await replayOrRecordable(
        runtime,
        tx,
        locked,
        "resolve_suggestion",
        command.idempotencyKey,
        {
          suggestionId: command.suggestionId,
          resolution: command.resolution,
          response: command.response,
          expectedSessionVersion: command.expectedSessionVersion,
        },
      );
      if (idem.replay) {
        return view(tx.sql, actor, locked);
      }
      const session = await lockedActiveSession(
        runtime,
        tx,
        actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const suggestion = await suggestions.findById(
        tx.sql,
        session.id,
        command.suggestionId,
      );
      if (suggestion === null) {
        throw new OnboardingSuggestionNotFoundError();
      }
      if (suggestion.status !== "PENDING") {
        throw new OnboardingSessionStateError("SUGGESTION_ALREADY_RESOLVED");
      }
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      const step = eligibleStep(aggregate, suggestion.stepKey);

      let updated: OnboardingSession;
      let changes: OnboardingPathChanges | undefined;
      let status: "ACCEPTED" | "EDITED" | "REJECTED";
      if (command.resolution === "REJECT") {
        // No canonical write, no fabricated negative value.
        status = "REJECTED";
        updated = await sessions.commit(tx, session.id, session.version, {});
      } else {
        status = command.resolution === "ACCEPT" ? "ACCEPTED" : "EDITED";
        const validated =
          command.resolution === "ACCEPT"
            ? validateOnboardingResponse(
                step,
                { value: suggestion.suggestedValue },
                { sourceModality: "SUGGESTION_ACCEPT" },
              )
            : validateOnboardingResponse(step, command.response, {
                sourceModality: "SUGGESTION_EDIT",
              });
        const committed = await commitResponse(
          runtime,
          tx,
          actor,
          aggregate,
          step,
          validated,
          command.correlationId,
          { resolvingSuggestionId: suggestion.id },
        );
        updated = committed.session;
        changes = committed.changes;
        await outbox.enqueue(
          tx,
          responseCommittedEvent({
            session: updated,
            correlationId: command.correlationId,
            stepKey: step.stepKey,
            responseId: committed.response.id,
          }),
        );
      }
      const resolved = await suggestions.resolve(tx, suggestion.id, status);
      if (!resolved) {
        throw new OnboardingSessionStateError("SUGGESTION_ALREADY_RESOLVED");
      }
      await idempotency.recordMutation(tx, {
        sessionId: session.id,
        keyHash: idem.keyHash,
        operation: "resolve_suggestion",
        requestHash: idem.requestHash,
        resultVersion: updated.version,
      });
      await outbox.enqueue(
        tx,
        suggestionResolvedEvent({
          session: updated,
          correlationId: command.correlationId,
          suggestionId: suggestion.id,
          stepKey: step.stepKey,
          resolution: status,
        }),
      );
      getOnboardingMetrics().suggestionsResolved.add(1, { resolution: status });
      safeLog(runtime, "suggestion.resolved", updated, {
        stepKey: step.stepKey,
        resolution: status,
      });
      return view(tx.sql, actor, updated, changes);
    });
  };

  const expireSuggestion = async (
    raw: ExpireOnboardingSuggestionCommand,
  ): Promise<OnboardingSuggestion> => {
    const command = z
      .object({
        sessionId: OnboardingSessionIdSchema,
        suggestionId: OnboardingSuggestionIdSchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    return transactions.run(async (tx) => {
      const session = await sessions.findById(tx.sql, command.sessionId);
      if (session === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const suggestion = await suggestions.findById(
        tx.sql,
        session.id,
        command.suggestionId,
      );
      if (suggestion === null) {
        throw new OnboardingSuggestionNotFoundError();
      }
      if (!(await suggestions.resolve(tx, suggestion.id, "EXPIRED"))) {
        throw new OnboardingSessionStateError("SUGGESTION_ALREADY_RESOLVED");
      }
      await outbox.enqueue(
        tx,
        suggestionResolvedEvent({
          session,
          correlationId: command.correlationId,
          suggestionId: suggestion.id,
          stepKey: suggestion.stepKey,
          resolution: "EXPIRED",
        }),
      );
      const expired = await suggestions.findById(
        tx.sql,
        session.id,
        suggestion.id,
      );
      if (expired === null) {
        throw new OnboardingSuggestionNotFoundError();
      }
      return expired;
    });
  };

  const questionsRepo = (): OnboardingInterviewQuestionRepository => {
    if (runtime.questions === undefined) {
      throw new OnboardingRuntimeConfigurationError(
        "QUESTIONS_UNAVAILABLE",
        "no interview question repository is composed",
      );
    }
    return runtime.questions;
  };

  /**
   * Records what a planner decided is worth asking (CQ-PRE-REC-001).
   * Trusted, internal. Every question must map to a step of the pinned
   * definition and every option must already be a valid answer for the step
   * it names, so nothing a client later submits from a question can be
   * anything the runtime would not have accepted typed. A new question for a
   * fact supersedes the pending one, so a re-plan never asks twice.
   */
  const recordInterviewQuestions = async (
    raw: RecordOnboardingQuestionsCommand,
  ): Promise<readonly OnboardingInterviewQuestion[]> => {
    const command = z
      .object({
        sessionId: OnboardingSessionIdSchema,
        questions: z
          .array(
            z
              .object({
                stepKey: OnboardingStepKeySchema,
                factKey: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/),
                question: z.string().min(1).max(500),
                why: z.string().max(500).nullable().default(null),
                reason: OnboardingQuestionReasonSchema,
                readings: z.array(z.string().max(200)).max(8).default([]),
                options: z
                  .array(
                    z.object({
                      label: z.string().min(1).max(120),
                      stepKey: OnboardingStepKeySchema,
                      value: OnboardingResponseValueSchema,
                    }),
                  )
                  .max(8)
                  .default([]),
                sourceRefs: OnboardingSourceRefsSchema.default([]),
              })
              .strict(),
          )
          .max(24),
      })
      .strict()
      .parse(raw);
    const questions = questionsRepo();
    return transactions.run(async (tx) => {
      const session = await sessions.findById(tx.sql, command.sessionId);
      if (session === null || session.status !== "ACTIVE") {
        throw new OnboardingSessionNotFoundError();
      }
      const published = await runtime.loadDefinition(
        tx.sql,
        session.definitionVersionId,
      );
      const stepsByKey = new Map(published.steps.map((s) => [s.stepKey, s]));
      for (const question of command.questions) {
        if (!stepsByKey.has(question.stepKey)) {
          throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
        }
        for (const option of question.options) {
          const step = stepsByKey.get(option.stepKey);
          if (step === undefined) {
            throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
          }
          validateOnboardingResponse(step, { value: option.value });
        }
      }
      await questions.supersedePending(
        tx,
        session.id,
        command.questions.map((q) => q.factKey),
      );
      const created: OnboardingInterviewQuestion[] = [];
      for (const question of command.questions) {
        created.push(
          await questions.insert(tx, {
            sessionId: session.id,
            stepKey: question.stepKey,
            factKey: question.factKey,
            question: question.question,
            why: question.why,
            reason: question.reason,
            readings: question.readings,
            options: question.options.map((option) =>
              OnboardingQuestionOptionViewSchema.parse(option),
            ),
            sourceRefs: question.sourceRefs,
          }),
        );
      }
      safeLog(runtime, "questions.recorded", session, {
        count: created.length,
      });
      return created;
    });
  };

  /**
   * Answers a question by committing a normal validated response to the
   * step it names — the same path a typed answer takes, write targets and
   * events included — and marking the question answered in the same
   * transaction. A question may only be answered on its own step or one of
   * its option steps, so a client cannot use it to reach an unrelated step.
   */
  const answerInterviewQuestion = async (
    raw: AnswerOnboardingQuestionCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        questionId: OnboardingInterviewQuestionIdSchema,
        stepKey: OnboardingStepKeySchema,
        response: z.unknown(),
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    const questions = questionsRepo();
    return transactions.run(async (tx) => {
      const locked = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (locked === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const idem = await replayOrRecordable(
        runtime,
        tx,
        locked,
        "answer_question",
        command.idempotencyKey,
        {
          questionId: command.questionId,
          stepKey: command.stepKey,
          response: command.response,
          expectedSessionVersion: command.expectedSessionVersion,
        },
      );
      if (idem.replay) {
        return view(tx.sql, actor, locked);
      }
      const session = await lockedActiveSession(
        runtime,
        tx,
        actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const question = await questions.findById(
        tx.sql,
        session.id,
        command.questionId,
      );
      if (question === null) {
        throw new OnboardingInterviewQuestionNotFoundError();
      }
      if (question.status !== "PENDING") {
        throw new OnboardingSessionStateError("QUESTION_ALREADY_RESOLVED");
      }
      const permitted = new Set([
        question.stepKey,
        ...question.options.map((option) => option.stepKey),
      ]);
      if (!permitted.has(command.stepKey)) {
        throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
      }
      const aggregate = await aggregateOf(runtime, tx.sql, session);
      const step = eligibleStep(aggregate, command.stepKey);
      const validated = validateOnboardingResponse(step, command.response);
      const committed = await commitResponse(
        runtime,
        tx,
        actor,
        aggregate,
        step,
        validated,
        command.correlationId,
      );
      await questions.resolve(tx, question.id, "ANSWERED");
      await idempotency.recordMutation(tx, {
        sessionId: session.id,
        keyHash: idem.keyHash,
        operation: "answer_question",
        requestHash: idem.requestHash,
        resultVersion: committed.session.version,
      });
      await outbox.enqueue(
        tx,
        responseCommittedEvent({
          session: committed.session,
          correlationId: command.correlationId,
          stepKey: step.stepKey,
          responseId: committed.response.id,
        }),
      );
      getOnboardingMetrics().responsesCommitted.add(1, {
        journeyType: session.journeyType,
        stepType: step.stepType,
      });
      safeLog(runtime, "question.answered", committed.session, {
        stepKey: step.stepKey,
        reason: question.reason,
      });
      return view(tx.sql, actor, committed.session, committed.changes);
    });
  };

  /** "I do not know" or "later": the question is set aside; nothing is written. */
  const dismissInterviewQuestion = async (
    raw: DismissOnboardingQuestionCommand,
  ): Promise<OnboardingSessionView> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        questionId: OnboardingInterviewQuestionIdSchema,
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    const questions = questionsRepo();
    return transactions.run(async (tx) => {
      const locked = await sessions.lockForUpdate(
        tx,
        command.sessionId,
        actor.userId,
      );
      if (locked === null) {
        throw new OnboardingSessionNotFoundError();
      }
      const idem = await replayOrRecordable(
        runtime,
        tx,
        locked,
        "dismiss_question",
        command.idempotencyKey,
        {
          questionId: command.questionId,
          expectedSessionVersion: command.expectedSessionVersion,
        },
      );
      if (idem.replay) {
        return view(tx.sql, actor, locked);
      }
      const session = await lockedActiveSession(
        runtime,
        tx,
        actor,
        command.sessionId,
        command.expectedSessionVersion,
      );
      const question = await questions.findById(
        tx.sql,
        session.id,
        command.questionId,
      );
      if (question === null) {
        throw new OnboardingInterviewQuestionNotFoundError();
      }
      if (question.status !== "PENDING") {
        throw new OnboardingSessionStateError("QUESTION_ALREADY_RESOLVED");
      }
      await questions.resolve(tx, question.id, "DISMISSED");
      const updated = await sessions.commit(
        tx,
        session.id,
        session.version,
        {},
      );
      await idempotency.recordMutation(tx, {
        sessionId: session.id,
        keyHash: idem.keyHash,
        operation: "dismiss_question",
        requestHash: idem.requestHash,
        resultVersion: updated.version,
      });
      safeLog(runtime, "question.dismissed", updated, {
        reason: question.reason,
      });
      return view(tx.sql, actor, updated);
    });
  };

  const utterancesRepo = (): OnboardingUtteranceRepository => {
    if (runtime.utterances === undefined) {
      throw new OnboardingRuntimeConfigurationError(
        "UTTERANCES_UNAVAILABLE",
        "no utterance repository is composed",
      );
    }
    return runtime.utterances;
  };

  /**
   * The conversational interview's one entry point (CQ-PRE-REC-001 §16-§21).
   *
   * What a person says about the current step is placed deterministically
   * where the pinned definition already knows how to hold it — an option, a
   * figure, a plain answer, a skip — through the very same submit and skip
   * paths a tap uses, so there is one persistence path and one validation.
   * A sentence nothing here can place is recorded for Q's reading, whose
   * proposals return as ordinary suggestions and questions for the person
   * to confirm. Nothing said becomes canonical by being said.
   */
  const say = async (
    raw: SayOnboardingCommand,
  ): Promise<SayOnboardingOutcome> => {
    const command = z
      .object({
        actor: ActorSchema,
        sessionId: OnboardingSessionIdSchema,
        text: z.string().trim().min(1).max(2000),
        expectedSessionVersion: VersionSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId: CorrelationIdSchema,
      })
      .strict()
      .parse(raw);
    const { actor } = command;
    const current = await getSession({ actor, sessionId: command.sessionId });
    if (current.session.status !== "ACTIVE" || current.currentStep === null) {
      throw new OnboardingSessionStateError("SESSION_NOT_ACTIVE");
    }
    if (current.session.version !== command.expectedSessionVersion) {
      throw new OnboardingSessionVersionConflictError();
    }
    const step = current.currentStep;
    const stepKey = step.stepKey;
    const reading = interpretUtterance(
      command.text,
      {
        stepKey,
        required: step.required,
        presentation: step.presentation,
        context: step.context,
      },
      runtime.utteranceAliases ?? {},
    );
    const why = step.whyQAsks ?? step.supportingText ?? null;
    const slug = (key: string): string =>
      key.toLowerCase().replace(/[^a-z0-9_.]/g, "_");
    const setKey = (values: readonly string[]): string =>
      createHash("sha256")
        .update([...values].sort().join("|"))
        .digest("hex")
        .slice(0, 8);
    const turnRef = {
      sourceType: "INTERVIEW_TURN",
      sourceId: command.idempotencyKey.slice(0, 200),
    };

    /**
     * Everything else the sentence answered (CQ-Q-VOICE-001 A §8-§12): each
     * other step it named unambiguously becomes a suggestion the person
     * confirms, retained until that step is reached; an ambiguous hit
     * becomes a choice; an exclusion mention becomes a confirmation
     * question; category phrases become taxonomy candidates through Capital
     * Q's own classifier. A failure here never fails the turn.
     */
    const proposeFromUtterance = async (
      placed: SayOnboardingOutcome,
      options: {
        readonly text: string;
        readonly onlyStepKeys?: readonly string[] | undefined;
        readonly includeCompleted?: boolean | undefined;
      },
    ): Promise<SayOnboardingOutcome> => {
      const kind = placed.understood.kind;
      if (
        kind !== "ANSWERED" &&
        kind !== "READING" &&
        kind !== "UNCLEAR" &&
        kind !== "AMBIGUOUS" &&
        kind !== "CORRECTED"
      ) {
        return placed;
      }
      if (wordsOf(options.text).length < 2) {
        return placed;
      }
      try {
        const session = await sessions.findById(sql, command.sessionId);
        if (session === null) {
          return placed;
        }
        const published = await runtime.loadDefinition(
          sql,
          session.definitionVersionId,
        );
        const states = await stepStates.listBySession(sql, session.id);
        const statusOf = new Map(states.map((s) => [s.stepKey, s.status]));
        const only =
          options.onlyStepKeys === undefined
            ? null
            : new Set(options.onlyStepKeys);
        const steps = published.steps
          .filter((s) => only === null || only.has(s.stepKey))
          .map((s) => ({
            stepKey: s.stepKey,
            status:
              options.includeCompleted === true
                ? ("UNSEEN" as const)
                : (statusOf.get(s.stepKey) ?? ("UNSEEN" as const)),
            configuration: s.configuration,
          }));
        const pendingSuggestions = await suggestions.listPending(
          sql,
          session.id,
        );
        const pendingQuestions =
          runtime.questions === undefined
            ? []
            : await runtime.questions.listPending(sql, session.id);
        const alreadySuggested = (
          key: string,
          value: OnboardingResponseValue,
        ): boolean =>
          pendingSuggestions.some(
            (s) =>
              s.stepKey === key &&
              JSON.stringify(s.suggestedValue) === JSON.stringify(value),
          );
        const alreadyAsked = (factKey: string): boolean =>
          pendingQuestions.some((q) => q.factKey === factKey);
        type QuestionToRecord = Parameters<
          typeof recordInterviewQuestions
        >[0]["questions"][number];
        const questionsToRecord: QuestionToRecord[] = [];
        let proposed = 0;

        const propose = async (
          key: string,
          value: OnboardingResponseValue,
          confidence: string,
        ): Promise<void> => {
          if (alreadySuggested(key, value)) {
            return;
          }
          try {
            await createSuggestion({
              sessionId: session.id,
              stepKey: key,
              targetField: slug(key),
              suggestedValue: value,
              sourceRefs: [turnRef],
              confidence,
              modelRunId: null,
            });
            proposed += 1;
          } catch (error: unknown) {
            // The definition refused the value (bounds, count, vocabulary):
            // nothing is proposed for that step, nothing else is lost.
            runtime.logger?.debug(
              {
                sessionId: session.id,
                stepKey: key,
                reason: error instanceof Error ? error.name : "unknown",
              },
              "onboarding.interview.proposal_refused",
            );
          }
        };

        const readings = resolveAcrossSteps({
          text: options.text,
          steps,
          currentStepKey: options.includeCompleted === true ? null : stepKey,
          aliases: runtime.utteranceAliases ?? {},
          cues: runtime.interviewCues ?? {},
        });
        for (const item of readings) {
          if (item.kind === "PROPOSE") {
            await propose(item.stepKey, item.value, "0.9");
          } else if (item.kind === "CHOOSE") {
            const factKey = `choice.${slug(item.stepKey)}.${setKey(item.options.map((o) => o.optionKey))}`;
            if (!alreadyAsked(factKey)) {
              questionsToRecord.push({
                stepKey: item.stepKey,
                factKey,
                question:
                  "I can see more than one that fits there. Which do you mean?",
                why: null,
                reason: "AMBIGUITY",
                readings: [],
                options: item.options.map((option) => ({
                  label: option.label,
                  stepKey: item.stepKey,
                  value: { type: "SINGLE_SELECT", optionKey: option.optionKey },
                })),
                sourceRefs: [turnRef],
              });
            }
          } else {
            const factKey = `exclusion.${slug(item.optionKey)}`;
            if (!alreadyAsked(factKey)) {
              questionsToRecord.push({
                stepKey: item.hardStepKey,
                factKey,
                question: `You mentioned ${item.label.toLowerCase()}. Should I never show you those, or just rank them lower?`,
                why: "A hard exclusion removes them entirely; nothing is excluded until you say so.",
                reason: "EXCLUSION_CONFIRMATION",
                readings: [],
                options: [
                  {
                    label: `Never show me ${item.label.toLowerCase()}`,
                    stepKey: item.hardStepKey,
                    value: {
                      type: "MULTI_SELECT",
                      optionKeys: [item.optionKey],
                    },
                  },
                  {
                    label: "Just show it lower",
                    stepKey: item.softStepKey,
                    value: {
                      type: "MULTI_SELECT",
                      optionKeys: [item.optionKey],
                    },
                  },
                ],
                sourceRefs: [turnRef],
              });
            }
          }
        }

        // The question Q is asking, when the sentence fits more than one of
        // its options: a choice that survives a refresh, with real options.
        if (
          placed.understood.kind === "AMBIGUOUS" &&
          step.presentation.stepType === "single_select"
        ) {
          const keys = new Set(placed.understood.optionKeys);
          const factKey = `choice.${slug(stepKey)}.${setKey([...keys])}`;
          if (!alreadyAsked(factKey)) {
            questionsToRecord.push({
              stepKey,
              factKey,
              question: "I can see more than one that fits. Which do you mean?",
              why: null,
              reason: "AMBIGUITY",
              readings: [],
              options: step.presentation.options
                .filter((option) => keys.has(option.optionKey))
                .map((option) => ({
                  label: option.label,
                  stepKey,
                  value: { type: "SINGLE_SELECT", optionKey: option.optionKey },
                })),
              sourceRefs: [turnRef],
            });
          }
        }

        // Category phrases → canonical candidates through Capital Q's own
        // classifier: strong ones are proposed as a set to keep or adjust;
        // weak ones are a choice among real options; nothing is invented.
        const taxonomy = runtime.taxonomy;
        if (taxonomy !== undefined) {
          const phrases = taxonomyPhrases(options.text).slice(0, 16);
          for (const target of steps) {
            const configuration = target.configuration;
            if (
              phrases.length === 0 ||
              configuration.stepType !== "reference_select" ||
              configuration.resourceType !== "TAXONOMY_NODE" ||
              target.status === "COMPLETED"
            ) {
              continue;
            }
            const results = await Promise.all(
              phrases.map((phrase) =>
                taxonomy.findCandidates({
                  text: phrase,
                  vocabularyCodes: configuration.vocabularyCodes,
                  limit: 3,
                }),
              ),
            );
            const { strong, ambiguous } = aggregateTaxonomyCandidates(results);
            if (strong.length > 0) {
              const chosen = strong.slice(0, configuration.maxItems);
              const value: OnboardingResponseValue = {
                type: "RESOURCE_REFERENCE",
                resourceType: "TAXONOMY_NODE",
                resourceIds: chosen.map((c) => c.nodeId),
              };
              if (!alreadySuggested(target.stepKey, value)) {
                for (const stale of pendingSuggestions.filter(
                  (existing) =>
                    existing.stepKey === target.stepKey &&
                    existing.suggestedValue.type === "RESOURCE_REFERENCE",
                )) {
                  await expireSuggestion({
                    sessionId: session.id,
                    suggestionId: stale.id,
                    correlationId: command.correlationId,
                  });
                }
              }
              await propose(
                target.stepKey,
                value,
                chosen[0]?.confidence ?? "0.6",
              );
            }
            if (ambiguous.length > 0) {
              const factKey = `taxonomy.${slug(target.stepKey)}.${setKey(ambiguous.map((c) => c.nodeId))}`;
              if (!alreadyAsked(factKey)) {
                questionsToRecord.push({
                  stepKey: target.stepKey,
                  factKey,
                  question:
                    "That could mean a few things here. Which is closest?",
                  why: null,
                  reason: "AMBIGUITY",
                  readings: [],
                  options: ambiguous.map((c) => ({
                    label: c.displayName,
                    stepKey: target.stepKey,
                    value: {
                      type: "RESOURCE_REFERENCE",
                      resourceType: "TAXONOMY_NODE",
                      resourceIds: [c.nodeId],
                    },
                  })),
                  sourceRefs: [turnRef],
                });
              }
            }
          }
        }

        if (questionsToRecord.length > 0 && runtime.questions !== undefined) {
          await recordInterviewQuestions({
            sessionId: session.id,
            questions: questionsToRecord,
          });
        }
        const asked = questionsToRecord.length;
        if (proposed === 0 && asked === 0) {
          return placed;
        }
        const view = await getSession({ actor, sessionId: command.sessionId });
        return {
          view,
          understood: { ...placed.understood, proposed: proposed + asked },
        };
      } catch (error: unknown) {
        runtime.logger?.warn(
          {
            sessionId: command.sessionId,
            reason: error instanceof Error ? error.name : "unknown",
          },
          "onboarding.interview.proposals_failed",
        );
        return placed;
      }
    };

    // A correction re-reads the words after the objection against the step
    // the person most recently answered, through the same supersede path
    // every revision uses (§14). A bare objection asks what should change.
    const correction = correctionIntent(command.text);
    if (correction !== null) {
      if (correction.remainder.length === 0) {
        return { view: current, understood: { kind: "DECLINED", stepKey } };
      }
      const session = await sessions.findById(sql, command.sessionId);
      const latest = (
        await runtime.responses.listCurrent(sql, command.sessionId)
      )
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (session !== null && latest !== undefined) {
        const published = await runtime.loadDefinition(
          sql,
          session.definitionVersionId,
        );
        const target = published.steps.find(
          (s) => s.stepKey === latest.stepKey,
        );
        if (target !== undefined) {
          const targetAliases = runtime.utteranceAliases ?? {};
          const again = interpretUtterance(
            correction.remainder,
            {
              stepKey: target.stepKey,
              required: target.required,
              presentation: presentationOf(target.configuration),
            },
            targetAliases,
          );
          if (again.kind === "ANSWER") {
            const view = await submitResponse({
              actor,
              sessionId: command.sessionId,
              stepKey: target.stepKey,
              response: { value: again.value },
              expectedSessionVersion: command.expectedSessionVersion,
              idempotencyKey: command.idempotencyKey,
              correlationId: command.correlationId,
            });
            return proposeFromUtterance(
              {
                view,
                understood: {
                  kind: "CORRECTED",
                  stepKey: target.stepKey,
                  summary: again.summary,
                },
              },
              { text: correction.remainder },
            );
          }
          if (
            target.configuration.stepType === "reference_select" &&
            target.configuration.resourceType === "TAXONOMY_NODE"
          ) {
            const proposedView = await proposeFromUtterance(
              {
                view: current,
                understood: {
                  kind: "CORRECTED",
                  stepKey: target.stepKey,
                  summary: correction.remainder.slice(0, 120),
                },
              },
              {
                text: correction.remainder,
                onlyStepKeys: [target.stepKey],
                includeCompleted: true,
              },
            );
            if (
              proposedView.understood.kind === "CORRECTED" &&
              (proposedView.understood.proposed ?? 0) > 0
            ) {
              return proposedView;
            }
          }
        }
      }
      // Nothing to correct against: the words are read as a normal turn.
    }

    // Records the sentence for Q's reading: one utterance row, one event
    // with identifiers only, replayed (not repeated) under the same key.
    const recordUtterance = async (input: {
      readonly expectedSessionVersion: number;
      readonly idempotencyKey: string;
    }) => {
      const utterances = utterancesRepo();
      return transactions.run(async (tx) => {
        const locked = await sessions.lockForUpdate(
          tx,
          command.sessionId,
          actor.userId,
        );
        if (locked === null) {
          throw new OnboardingSessionNotFoundError();
        }
        const idem = await replayOrRecordable(
          runtime,
          tx,
          locked,
          "say",
          input.idempotencyKey,
          {
            text: command.text,
            expectedSessionVersion: input.expectedSessionVersion,
          },
        );
        const session = await lockedActiveSession(
          runtime,
          tx,
          actor,
          command.sessionId,
          input.expectedSessionVersion,
        );
        if (idem.replay) {
          // Replayed: the utterance is already recorded and being read.
          const pending = await utterances.listPending(tx.sql, session.id);
          return { session, utteranceId: pending.at(-1)?.id };
        }
        const utterance = await utterances.insert(tx, {
          sessionId: session.id,
          stepKey,
          text: command.text,
        });
        await idempotency.recordMutation(tx, {
          sessionId: session.id,
          keyHash: idem.keyHash,
          operation: "say",
          requestHash: idem.requestHash,
          resultVersion: session.version,
        });
        await outbox.enqueue(
          tx,
          utteranceRecordedEvent({
            session,
            correlationId: command.correlationId,
            utteranceId: utterance.id,
            stepKey,
          }),
        );
        safeLog(runtime, "utterance.recorded", session, { stepKey });
        return { session, utteranceId: utterance.id };
      });
    };

    const placed = await (async (): Promise<SayOnboardingOutcome> => {
      switch (reading.kind) {
        case "ANSWER": {
          let view = await submitResponse({
            actor,
            sessionId: command.sessionId,
            stepKey,
            // The step's own default modality applies: a definition that only
            // takes selections records a typed option as one.
            response: { value: reading.value },
            expectedSessionVersion: command.expectedSessionVersion,
            idempotencyKey: command.idempotencyKey,
            correlationId: command.correlationId,
          });
          // A rich sentence that names an option carries more than the option
          // ("Series A and B in fintech across Nigeria, one to three million"):
          // the option is placed now and the sentence is read by Q as well, so
          // nothing the person said is dropped (CQ-PRE-REC-001 §44).
          let utteranceId: string | undefined;
          if (isRichUtterance(command.text)) {
            const recorded = await recordUtterance({
              expectedSessionVersion: view.session.version,
              idempotencyKey: `${command.idempotencyKey}:reading`,
            });
            utteranceId = recorded.utteranceId;
            view = await getSession({ actor, sessionId: command.sessionId });
          }
          return {
            view,
            understood: {
              kind: "ANSWERED",
              stepKey,
              summary: reading.summary,
              ...(utteranceId === undefined ? {} : { utteranceId }),
            },
          };
        }
        case "SKIP": {
          if (step.required) {
            return {
              view: current,
              understood: { kind: "REQUIRED", stepKey, why },
            };
          }
          const view = await skipStep({
            actor,
            sessionId: command.sessionId,
            stepKey,
            expectedSessionVersion: command.expectedSessionVersion,
            idempotencyKey: command.idempotencyKey,
            correlationId: command.correlationId,
          });
          return { view, understood: { kind: "SKIPPED", stepKey } };
        }
        case "WHY":
          return { view: current, understood: { kind: "WHY", stepKey, why } };
        case "UPLOAD":
          return { view: current, understood: { kind: "UPLOAD", stepKey } };
        case "AMBIGUOUS":
          return {
            view: current,
            understood: {
              kind: "AMBIGUOUS",
              stepKey,
              optionKeys: [...reading.optionKeys],
            },
          };
        case "DECLINE":
          return { view: current, understood: { kind: "DECLINED", stepKey } };
        case "UNCLEAR":
          return { view: current, understood: { kind: "UNCLEAR", stepKey } };
        case "NARRATIVE": {
          const recorded = await recordUtterance({
            expectedSessionVersion: command.expectedSessionVersion,
            idempotencyKey: command.idempotencyKey,
          });
          const view = await getSession({
            actor,
            sessionId: command.sessionId,
          });
          return {
            view,
            understood:
              recorded.utteranceId === undefined
                ? { kind: "UNCLEAR", stepKey }
                : {
                    kind: "READING",
                    stepKey,
                    utteranceId: recorded.utteranceId,
                  },
          };
        }
      }
    })();
    return proposeFromUtterance(placed, { text: command.text });
  };

  return {
    startSession,
    getCurrentSession,
    getSession,
    bindSessionContext,
    submitResponse,
    skipStep,
    goBack,
    completeSession,
    createSuggestion,
    resolveSuggestion,
    expireSuggestion,
    recordInterviewQuestions,
    answerInterviewQuestion,
    dismissInterviewQuestion,
    say,
  };
}

export type OnboardingUseCases = ReturnType<typeof createOnboardingUseCases>;
