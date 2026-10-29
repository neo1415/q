import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AppendOnboardingInterviewTurnsRequestSchema,
  GetOnboardingCoverageResponseSchema,
  ONBOARDING_COVERAGE_SEGMENT,
  AppendOnboardingInterviewTurnsResponseSchema,
  ListOnboardingInterviewTurnsQuerySchema,
  ListOnboardingInterviewTurnsResponseSchema,
  ListOnboardingInterviewTurnStepsResponseSchema,
  ONBOARDING_TURN_STEPS_SEGMENT,
  ONBOARDING_TURNS_SEGMENT,
  CorrelationIdSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ONBOARDING_SAY_SEGMENT,
  SayOnboardingRequestSchema,
  SayOnboardingResponseSchema,
  ONBOARDING_BACK_SEGMENT,
  ONBOARDING_CURRENT_SEGMENT,
  OnboardingJourneyTypeSchema,
  ONBOARDING_PATH,
  ONBOARDING_SESSIONS_SEGMENT,
  OnboardingBackRequestSchema,
  OnboardingSessionViewSchema,
  parseContract,
  StartOnboardingSessionRequestSchema,
  ONBOARDING_NUDGE_SEGMENT,
  ONBOARDING_NUDGE_BRIEFING_SEGMENT,
  OnboardingBriefingNudgeResponseSchema,
  createProblemDetails,
  Q_INTERVIEW_STREAM_EVENTS,
  Q_SSE_CONTENT_TYPE,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  OnboardingSessionIdSchema,
  OnboardingSessionNotFoundError,
  OnboardingSessionVersionConflictError,
  type OnboardingNudges,
  type OnboardingService,
  type OnboardingSessionId,
} from "@capital-q/onboarding";
import { createCorrelationId } from "@capital-q/observability";
import type { OnboardingCoverageReader } from "../onboarding-coverage.js";
import {
  QAccountPausedError,
  QInterviewUnavailableError,
  type QInterviewClient,
} from "../q/interview-client.js";
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
  /**
   * The one Q interviewer (QX-004 core gate: one Q).
   *
   * `/say` delegates the whole turn to it. There is deliberately no
   * fallback to the template conversation this service used to run: two
   * engines is the defect, and quietly reverting to the weaker one under
   * load would hide it rather than fix it. Absent means the conversational
   * interview is closed, not degraded.
   */
  readonly qInterview: QInterviewClient | undefined;
  /**
   * The canonical coverage projection of the caller's own session (lane
   * ob1). Absent: the coverage route is not registered.
   */
  readonly coverage?: OnboardingCoverageReader | undefined;
  /** Setup reminders (founder directive 2026-09-27). Absent: none are given. */
  readonly nudges?:
    Pick<OnboardingNudges, "peek" | "claimBriefing" | "choose"> | undefined;
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

  // Answers, revisions, skip, withdraw, completion, suggestions, interview
  // questions and the setup-reminder choice are generated from the action
  // registry under this same onboarding actor (ADR 0040, app-actions.ts).

  // The conversational interview (CQ-PRE-REC-001 §16-§21): what a person
  // says about the current step is placed through the same submit and skip
  // paths a tap uses, or recorded for Q's reading. The reply says which.
  app.post(
    `${byId}${ONBOARDING_SAY_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      // Still required: the header is what makes a repeated turn safe, and
      // it is the browser's own retry key whichever engine answers.
      idempotencyKey(request, "say something to Q");
      const input = parseContract(
        SayOnboardingRequestSchema,
        request.body,
        "The message is not valid.",
      );
      const interviewer = dependencies.qInterview;
      if (interviewer === undefined) {
        throw new QInterviewUnavailableError("no interviewer is composed");
      }
      const sessionId = sessionIdParam(request);
      const actor = getOnboardingActor(request);

      // The interviewer works under the caller's own bearer, exactly as
      // the spoken thread does, so a typed turn can do what the person
      // could have done by tapping and no more.
      const header = request.headers.authorization;
      const accessToken =
        typeof header === "string" && header.toLowerCase().startsWith("bearer ")
          ? header.slice(7).trim()
          : "";

      const before = await runtime.getSession({ actor, sessionId });
      // Only an opening is refused on a moved session: it asks Q what to
      // ask, and the screen re-reads instead. Words the person typed are
      // never refused for it (onboarding speed 2026-10-20): a document
      // reading or a held save bumps the version between turns, and the
      // browser drops a conflicted turn rather than retry it, so their
      // answer was silently lost. The interviewer writes through the
      // ordinary submit path, which re-reads the version for every write.
      if (
        input.text.length === 0 &&
        before.session.version !== input.expectedSessionVersion
      ) {
        throw new OnboardingSessionVersionConflictError();
      }

      const turnRequest = {
        onboardingSessionId: sessionId,
        journeyType: before.session.journeyType,
        utterance: input.text,
        channel: "text" as const,
        recentTurns: input.recentTurns,
        ...(input.focus === undefined ? {} : { focus: input.focus }),
        ...(input.confirmReview === undefined
          ? {}
          : { confirmReview: input.confirmReview }),
      };
      const respond = async (
        turn: Awaited<ReturnType<QInterviewClient["turn"]>>,
      ) => {
        // What was recorded is read back from the session, never from the
        // prose: the reply is Q's words and is not evidence of a write. The
        // step Q asked comes with it, so its options show under Q's words.
        const after = await runtime.getSession({
          actor,
          sessionId,
          askedStepKey: turn.askingAbout?.[0],
        });
        return SayOnboardingResponseSchema.parse({
          view: after,
          understood: null,
          reply: turn.reply,
          navigate: turn.navigate,
          researching: turn.researching,
          degraded: turn.degraded,
          askingAbout: turn.askingAbout,
          pending: turn.pending,
          ...(turn.conduct === undefined ? {} : { conduct: turn.conduct }),
          ...(turn.gestures === undefined ? {} : { gestures: turn.gestures }),
        });
      };

      // Turn latency 2026-10-21 (onboarding L9): asked for a stream, Q's
      // reply goes on to the browser a sentence at a time as q-api writes
      // it, then the same response the JSON form returns, as `result`.
      const accept = request.headers.accept;
      if (
        typeof accept === "string" &&
        accept.toLowerCase().includes(Q_SSE_CONTENT_TYPE)
      ) {
        const stream = lazySseStream(reply);
        try {
          const turn = await interviewer.turnStream({
            accessToken,
            request: turnRequest,
            onSentence: (text) => {
              stream.write(Q_INTERVIEW_STREAM_EVENTS.SENTENCE, { text });
            },
            onStage: (stage) => {
              stream.write(Q_INTERVIEW_STREAM_EVENTS.STAGE, stage);
            },
          });
          stream.end(Q_INTERVIEW_STREAM_EVENTS.RESULT, await respond(turn));
          return reply;
        } catch (error) {
          // Nothing sent yet: the ordinary problem reply, status and all.
          if (!stream.started()) throw error;
          request.log.warn(
            { err: error },
            "streamed onboarding turn failed after its first sentence",
          );
          stream.end(
            Q_INTERVIEW_STREAM_EVENTS.PROBLEM,
            error instanceof QAccountPausedError
              ? {
                  ...createProblemDetails({
                    code: "PERMISSION_DENIED",
                    requestId: request.id,
                    detail: error.message,
                  }),
                  paused: true,
                }
              : createProblemDetails({
                  code: "PROVIDER_UNAVAILABLE",
                  requestId: request.id,
                }),
          );
          return reply;
        }
      }

      const turn = await interviewer.turn({
        accessToken,
        request: turnRequest,
      });
      void reply.header("Cache-Control", "no-store");
      return respond(turn);
    },
  );

  // Coverage (lane ob1): what the journey knows, per field, for the form
  // and the conversation alike. Ownership is the runtime's check (the view
  // is read under the actor first); the projection reads nothing else of
  // anyone's but the caller's own.
  const coverage = dependencies.coverage;
  if (coverage !== undefined) {
    app.get(
      `${byId}${ONBOARDING_COVERAGE_SEGMENT}`,
      { onRequest: withActor },
      async (request, reply) => {
        const actor = getOnboardingActor(request);
        const view = await runtime.getSession({
          actor,
          sessionId: sessionIdParam(request),
        });
        const projected = await coverage(actor, view);
        if (projected === null) {
          throw new OnboardingSessionNotFoundError();
        }
        void reply.header("Cache-Control", "no-store");
        return GetOnboardingCoverageResponseSchema.parse({
          coverage: projected,
        });
      },
    );
  }

  // The interview thread (CQ-QX-006): what was said on screen, both sides
  // and both modalities, so a reload redraws the conversation. Ownership is
  // checked by the runtime from the actor; the path's session id is input.
  app.get(
    `${byId}${ONBOARDING_TURNS_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const query = parseContract(
        ListOnboardingInterviewTurnsQuerySchema,
        request.query ?? {},
        "The thread request is not valid.",
      );
      const items = await runtime.listInterviewTurns({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        limit: query.limit,
      });
      void reply.header("Cache-Control", "no-store");
      // Only what the thread shows: the interviewer's step bookkeeping is
      // not part of the conversation the browser redraws.
      return ListOnboardingInterviewTurnsResponseSchema.parse({
        items: items.map((t) => ({
          role: t.role,
          text: t.text,
          channel: t.channel,
          createdAt: t.createdAt,
        })),
      });
    },
  );

  // The same thread with each line's step and reading, for Q's interviewer
  // (asked-question memory and earlier statements survive a restart). Same
  // owner check: it is the person's own conversation, read under their
  // bearer.
  app.get(
    `${byId}${ONBOARDING_TURN_STEPS_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const query = parseContract(
        ListOnboardingInterviewTurnsQuerySchema,
        request.query ?? {},
        "The thread request is not valid.",
      );
      const items = await runtime.listInterviewTurns({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        limit: query.limit,
      });
      void reply.header("Cache-Control", "no-store");
      return ListOnboardingInterviewTurnStepsResponseSchema.parse({ items });
    },
  );

  // Idempotent by the body's turnRef: 201 when anything was written, 200
  // when the exchange was already recorded.
  app.post(
    `${byId}${ONBOARDING_TURNS_SEGMENT}`,
    { onRequest: withActor },
    async (request, reply) => {
      const input = parseContract(
        AppendOnboardingInterviewTurnsRequestSchema,
        request.body,
        "The thread entry is not valid.",
      );
      const result = await runtime.appendInterviewTurns({
        actor: getOnboardingActor(request),
        sessionId: sessionIdParam(request),
        turnRef: input.turnRef,
        turns: input.turns,
        ...(input.stated === undefined ? {} : { stated: input.stated }),
      });
      void reply
        .status(result.written ? 201 : 200)
        .header("Cache-Control", "no-store");
      return AppendOnboardingInterviewTurnsResponseSchema.parse(result);
    },
  );

  // Setup reminders: the person's own, by the authenticated principal.
  // Both are safe to repeat (a second claim the same day returns the same
  // card; a second choice sets the same thing), so neither takes an
  // Idempotency-Key.
  const nudges = dependencies.nudges;
  if (nudges !== undefined) {
    const nudgePath = `${ONBOARDING_PATH}${ONBOARDING_NUDGE_SEGMENT}`;
    // Reading whether today's Home reminder is due changes nothing: a page
    // render, or a prefetch of it, never uses the day's reminder up. The
    // POST below claims it, once the card is actually on screen.
    app.get(
      `${nudgePath}${ONBOARDING_NUDGE_BRIEFING_SEGMENT}`,
      { onRequest: withActor },
      async (request, reply) => {
        const nudge = await nudges.peek(getOnboardingActor(request).userId, {
          surface: "BRIEFING",
        });
        void reply.header("Cache-Control", "no-store");
        return OnboardingBriefingNudgeResponseSchema.parse({ nudge });
      },
    );
    app.post(
      `${nudgePath}${ONBOARDING_NUDGE_BRIEFING_SEGMENT}`,
      { onRequest: withActor },
      async (request, reply) => {
        const nudge = await nudges.claimBriefing(
          getOnboardingActor(request).userId,
        );
        void reply.header("Cache-Control", "no-store");
        return OnboardingBriefingNudgeResponseSchema.parse({ nudge });
      },
    );
  }
}

/**
 * One SSE response, opened at its first write: until then the route can
 * still fail with its ordinary problem reply. A closed connection stops
 * the writing, never the turn.
 */
function lazySseStream(reply: FastifyReply): {
  readonly write: (event: string, data: unknown) => void;
  readonly started: () => boolean;
  readonly end: (event: string, data: unknown) => void;
} {
  let open = false;
  let ended = false;
  const start = () => {
    if (open) return;
    open = true;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": Q_SSE_CONTENT_TYPE,
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
  };
  const frame = (event: string, data: unknown) => {
    start();
    if (reply.raw.destroyed) return;
    // JSON has no raw line breaks, so one `data:` line carries it whole.
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return {
    write: (event, data) => {
      if (!ended) frame(event, data);
    },
    started: () => open,
    end: (event, data) => {
      if (ended) return;
      ended = true;
      frame(event, data);
      reply.raw.end();
    },
  };
}
