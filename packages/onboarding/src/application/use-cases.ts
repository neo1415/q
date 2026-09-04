import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CorrelationIdSchema,
  OnboardingJourneyTypeSchema,
  OnboardingResponseValueSchema,
  OnboardingStepKeySchema,
  OnboardingSubjectTypeSchema,
  OnboardingSuggestionResolutionSchema,
  UuidSchema,
  type CorrelationId,
  type OnboardingJourneyType,
  type OnboardingPathChanges,
  type OnboardingSessionView,
  type OnboardingSuggestionResolution,
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
  OnboardingResponseIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSourceRefsSchema,
  OnboardingSuggestionConfidenceSchema,
  OnboardingSuggestionIdSchema,
  type OnboardingActor,
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
  OnboardingWriteContext,
  OnboardingDefinitionRepository,
  OnboardingIdempotencyRepository,
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingStepContextRegistry,
  OnboardingStepStateRepository,
  OnboardingSubjectResolverRegistry,
  OnboardingSuggestionRepository,
  OnboardingWriteTargetRegistry,
} from "./ports.js";
import {
  createDefinitionCache,
  loadAggregate,
  toSessionView,
  type OnboardingSessionAggregate,
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
  };
}

export type OnboardingUseCases = ReturnType<typeof createOnboardingUseCases>;
