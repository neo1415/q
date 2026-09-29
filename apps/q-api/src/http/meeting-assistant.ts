import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  PROBLEM_CONTENT_TYPE,
  Q_MEETING_ASSISTANT_PATH,
  QMeetingAssistantDtoSchema,
} from "@capital-q/contracts";
import type {
  MeetingAssistantOutcome,
  MeetingAssistantService,
} from "@capital-q/communication";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Q in a meeting (founder direction 2026-09-29): the organiser brings Q to
 * a booked call, sees whether it is there, and reads its notes. The id is
 * input; the service answers only for the meeting's own organiser, and a
 * meeting that is not theirs is the same 404 as one that does not exist.
 * Bringing Q is their click on this exact call, idempotent by its key.
 */

export type MeetingAssistantRoutesDependencies = ActorContextDependencies & {
  readonly assistant: MeetingAssistantService;
};

const ParamsSchema = z.object({ meetingId: z.string().uuid() }).strict();

const REFUSED: Readonly<
  Record<
    Extract<MeetingAssistantOutcome, { outcome: "REFUSED" }>["code"],
    { readonly status: 404 | 409 | 503; readonly detail: string }
  >
> = {
  NOT_FOUND: { status: 404, detail: "Not found." },
  NO_LINK: {
    status: 409,
    detail: "Q can join once the call is booked with a Meet link.",
  },
  OVER: { status: 409, detail: "That call has already ended." },
  UNAVAILABLE: {
    status: 503,
    detail: "Q can't join calls right now. Try again later.",
  },
};

function refused(
  request: FastifyRequest,
  reply: FastifyReply,
  code: keyof typeof REFUSED,
) {
  const { status, detail } = REFUSED[code];
  const problem = createProblemDetails({
    code:
      status === 404
        ? "RESOURCE_NOT_FOUND"
        : status === 409
          ? "RESOURCE_CONFLICT"
          : "PROVIDER_UNAVAILABLE",
    requestId: request.id,
    detail,
  });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerMeetingAssistantRoutes(
  app: FastifyInstance,
  dependencies: MeetingAssistantRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { assistant } = dependencies;

  app.get(
    Q_MEETING_ASSISTANT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const found = await assistant.read(
        getActorContext(request),
        params.data.meetingId,
      );
      if (found === null) return refused(request, reply, "NOT_FOUND");
      void reply.header("Cache-Control", "no-store");
      return QMeetingAssistantDtoSchema.parse(found);
    },
  );

  app.post(
    Q_MEETING_ASSISTANT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
      const key = IdempotencyKeyHeaderSchema.safeParse(
        typeof raw === "string" ? raw : undefined,
      );
      if (!key.success) {
        const problem = createProblemDetails({
          code: "VALIDATION_FAILED",
          requestId: request.id,
          detail: "An Idempotency-Key header is required to bring Q.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const outcome = await assistant.bring(
        getActorContext(request),
        params.data.meetingId,
        key.data,
      );
      if (outcome.outcome === "REFUSED") {
        return refused(request, reply, outcome.code);
      }
      void reply.header("Cache-Control", "no-store");
      return QMeetingAssistantDtoSchema.parse(outcome.assistant);
    },
  );

  app.delete(
    Q_MEETING_ASSISTANT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const outcome = await assistant.dismiss(
        getActorContext(request),
        params.data.meetingId,
      );
      if (outcome.outcome === "REFUSED") {
        return refused(request, reply, outcome.code);
      }
      void reply.header("Cache-Control", "no-store");
      return QMeetingAssistantDtoSchema.parse(outcome.assistant);
    },
  );
}
