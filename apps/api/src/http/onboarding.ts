import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AnswerOnboardingQuestionRequestSchema,
  CompleteOnboardingSessionRequestSchema,
  DismissOnboardingQuestionRequestSchema,
  CorrelationIdSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ONBOARDING_ANSWER_SEGMENT,
  ONBOARDING_SAY_SEGMENT,
  SayOnboardingRequestSchema,
  SayOnboardingResponseSchema,
  ONBOARDING_BACK_SEGMENT,
  ONBOARDING_DISMISS_SEGMENT,
  ONBOARDING_QUESTIONS_SEGMENT,
  ONBOARDING_COMPLETE_SEGMENT,
  ONBOARDING_CURRENT_SEGMENT,
  OnboardingJourneyTypeSchema,
  ONBOARDING_PATH,
  ONBOARDING_RESOLVE_SEGMENT,
  ONBOARDING_RESPONSES_SEGMENT,
  ONBOARDING_SESSIONS_SEGMENT,
  ONBOARDING_SKIP_SEGMENT,
  ONBOARDING_STEPS_SEGMENT,
  ONBOARDING_SUGGESTIONS_SEGMENT,
  OnboardingBackRequestSchema,
  OnboardingSessionViewSchema,
  OnboardingStepKeySchema,
  parseContract,
  ResolveOnboardingSuggestionRequestSchema,
  SkipOnboardingStepRequestSchema,
  StartOnboardingSessionRequestSchema,
  SubmitOnboardingResponseRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  OnboardingInterviewQuestionIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSessionNotFoundError,
  OnboardingSuggestionIdSchema,
  type OnboardingInterviewQuestionId,
  type OnboardingService,
  type OnboardingSessionId,
  type OnboardingSuggestionId,
} from "@capital-q/onboarding";
import { createCorrelationId } from "@capital-q/observability";

import {
  getOnboardingActor,
  requireOnboardingActorHook,
  type OnboardingActorDependencies,
} from "../security/onboarding-actor.js";

/**
 * `/v1/onboarding/sessions` -- the generic runtime API. Every route takes
 * the onboarding actor (Person id + optional organisation context) from the
 * server-side hook; the body never names a tenant, organisation, user or
 * definition version. Mutations carry expectedSessionVersion and, where
 * they create state, an Idempotency-Key. Responses are the safe session
 * view: no write targets, no branching, no handler keys. No route exposes
 * definitions, suggestion creation or context binding to the browser.
 */

export type OnboardingRoutesDependencies = OnboardingActorDependencies & {
  readonly onboarding: OnboardingService["runtime"];
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function sessionIdParam(request: FastifyRequest): OnboardingSessionId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    OnboardingSessionIdSchema,
    params["sessionId"],
    "The onboarding session identifier is not valid.",
  );
}

function stepKeyParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    OnboardingStepKeySchema,
    params["stepKey"],
    "The step key is not valid.",
  );
}

function questionIdParam(
  request: FastifyRequest,
): OnboardingInterviewQuestionId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    OnboardingInterviewQuestionIdSchema,
    params["questionId"],
    "The question identifier is not valid.",
  );
}

function suggestionIdParam(request: FastifyRequest): OnboardingSuggestionId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    OnboardingSuggestionIdSchema,
    params["suggestionId"],
    "The suggestion identifier is not valid.",
  );
}

function idempotencyKey(request: FastifyRequest, purpose: string): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    `An Idempotency-Key header is required to ${purpose}.`,
  );
}

export function registerOnboardingRoutes(
  app: FastifyInstance,
  dependencies: OnboardingRoutesDependencies,
): void {
  const withActor = requireOnboardingActorHook(dependencies);
  const runtime = dependencies.onboarding;
  const sessions = `${ONBOARDING_PATH}${ONBOARDING_SESSIONS_SEGMENT}`;
  const byId = `${sessions}/:sessionId`;

  app.post(sessions, { onRequest: withActor }, async (request, reply) => {
    const key = idempotencyKey(request, "start an onboarding session");
    const input = parseContract(
      StartOnboardingSessionRequestSchema,
      request.body,
      "The onboarding session request is not valid.",
    );
    const result = await runtime.startSession({
      actor: getOnboardingActor(request),
      journeyType: input.journeyType,
      subject:
        input.subject === undefined
          ? undefined
          : { subjectType: input.subject.type, subjectId: input.subject.id },
      idempotencyKey: key,
      correlationId: correlation(),
    });
    void reply
      .status(result.created ? 201 : 200)
      .header("Location", `${sessions}/${result.view.session.id}`)
      .header("Cache-Control", "no-store");
    return OnboardingSessionViewSchema.parse(result.view);
  });

  // Static segment registered before the parameterised one; find-my-way
  // prefers it, so "current" can never be read as a session id.
  app.get(
    `${sessions}${ONBOARDING_CURRENT_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const journeyType = parseContract(
        OnboardingJourneyTypeSchema,
        query["journeyType"],
        "The journey type is not valid.",
      );
      const view = await runtime.getCurrentSession({
        actor: getOnboardingActor(request),
        journeyType,
      });
      if (view === null) {
        throw new OnboardingSessionNotFoundError();
      }
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  app.get(byId, { onRequest: withActor }, async (request, reply) => {
    const view = await runtime.getSession({
      actor: getOnboardingActor(request),
      sessionId: sessionIdParam(request),
    });
    void reply.header("Cache-Control", "no-store");
    return OnboardingSessionViewSchema.parse(view);
  });

  app.post(
    `${byId}${ONBOARDING_RESPONSES_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "submit an onboarding response");
      const input = parseContract(
        SubmitOnboardingResponseRequestSchema,
        request.body,
        "The onboarding response request is not valid.",
      );
      const view = await runtime.submitResponse({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        stepKey: input.stepKey,
        response: input.response,
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  app.post(
    `${byId}${ONBOARDING_STEPS_SEGMENT}/:stepKey${ONBOARDING_SKIP_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "skip an onboarding step");
      const input = parseContract(
        SkipOnboardingStepRequestSchema,
        request.body,
        "The skip request is not valid.",
      );
      const view = await runtime.skipStep({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        stepKey: stepKeyParam(request),
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  app.post(
    `${byId}${ONBOARDING_BACK_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const input = parseContract(
        OnboardingBackRequestSchema,
        request.body,
        "The back request is not valid.",
      );
      const view = await runtime.goBack({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        expectedSessionVersion: input.expectedSessionVersion,
        targetStepKey: input.targetStepKey,
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  app.post(
    `${byId}${ONBOARDING_COMPLETE_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const input = parseContract(
        CompleteOnboardingSessionRequestSchema,
        request.body,
        "The completion request is not valid.",
      );
      const view = await runtime.completeSession({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        expectedSessionVersion: input.expectedSessionVersion,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  app.post(
    `${byId}${ONBOARDING_SUGGESTIONS_SEGMENT}/:suggestionId${ONBOARDING_RESOLVE_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "resolve an onboarding suggestion");
      const input = parseContract(
        ResolveOnboardingSuggestionRequestSchema,
        request.body,
        "The suggestion resolution request is not valid.",
      );
      const view = await runtime.resolveSuggestion({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        suggestionId: suggestionIdParam(request),
        resolution: input.resolution,
        response: input.response,
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );
  // Interview questions (CQ-PRE-REC-001): answering commits a normal
  // validated response to the mapped step; dismissing writes nothing.
  app.post(
    `${byId}${ONBOARDING_QUESTIONS_SEGMENT}/:questionId${ONBOARDING_ANSWER_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "answer an onboarding question");
      const input = parseContract(
        AnswerOnboardingQuestionRequestSchema,
        request.body,
        "The answer request is not valid.",
      );
      const view = await runtime.answerInterviewQuestion({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        questionId: questionIdParam(request),
        stepKey: input.stepKey,
        response: input.response,
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );

  // The conversational interview (CQ-PRE-REC-001 §16-§21): what a person
  // says about the current step is placed through the same submit and skip
  // paths a tap uses, or recorded for Q's reading. The reply says which.
  app.post(
    `${byId}${ONBOARDING_SAY_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "say something to Q");
      const input = parseContract(
        SayOnboardingRequestSchema,
        request.body,
        "The message is not valid.",
      );
      const outcome = await runtime.say({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        text: input.text,
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return SayOnboardingResponseSchema.parse(outcome);
    },
  );

  app.post(
    `${byId}${ONBOARDING_QUESTIONS_SEGMENT}/:questionId${ONBOARDING_DISMISS_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const key = idempotencyKey(request, "dismiss an onboarding question");
      const input = parseContract(
        DismissOnboardingQuestionRequestSchema,
        request.body,
        "The dismiss request is not valid.",
      );
      const view = await runtime.dismissInterviewQuestion({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        questionId: questionIdParam(request),
        expectedSessionVersion: input.expectedSessionVersion,
        idempotencyKey: key,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return OnboardingSessionViewSchema.parse(view);
    },
  );
}
