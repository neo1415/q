import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_INVESTOR_REHEARSALS_PATH,
  Q_REHEARSAL_FINISH_PATH,
  Q_REHEARSAL_PATH,
  Q_REHEARSAL_TURNS_PATH,
  Q_REHEARSALS_PATH,
  QRehearsalDtoSchema,
  QRehearsalListDtoSchema,
  RehearsalTurnRequestSchema,
  StartRehearsalRequestSchema,
} from "@capital-q/contracts";

import type {
  RehearsalOutcome,
  RehearsalService,
} from "../composition/rehearsals.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The Investor Twin (founder direction 2026-09-30, C12). The founder
 * starts, continues, finishes and reads their own rehearsals. Ids are
 * input: the service answers only for the rehearsal's own person and
 * tenant, so someone else's rehearsal is the same 404 as none.
 */

export type RehearsalRoutesDependencies = ActorContextDependencies & {
  readonly rehearsals: RehearsalService;
};

const RehearsalParamsSchema = z
  .object({ rehearsalId: z.string().uuid() })
  .strict();
const InvestorParamsSchema = z
  .object({ investorOrganisationId: z.string().uuid() })
  .strict();

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code:
    | "RESOURCE_NOT_FOUND"
    | "PERMISSION_DENIED"
    | "RESOURCE_CONFLICT"
    | "PROVIDER_UNAVAILABLE"
    | "INVALID_REQUEST",
  detail: string,
) {
  const body = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(body.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(body);
}

function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: RehearsalOutcome,
) {
  switch (outcome.kind) {
    case "OK":
      void reply.header("Cache-Control", "no-store");
      return QRehearsalDtoSchema.parse(outcome.rehearsal);
    case "NOT_FOUND":
      return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    case "NOT_A_FOUNDER":
      return problem(
        request,
        reply,
        "PERMISSION_DENIED",
        "Rehearsals are for a company's own people.",
      );
    case "FINISHED":
      return problem(
        request,
        reply,
        "RESOURCE_CONFLICT",
        "This rehearsal has finished.",
      );
    case "Q_UNAVAILABLE":
      return problem(
        request,
        reply,
        "PROVIDER_UNAVAILABLE",
        "Q couldn't play the investor just now. Try again in a moment.",
      );
  }
}

export function registerRehearsalRoutes(
  app: FastifyInstance,
  dependencies: RehearsalRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { rehearsals } = dependencies;

  app.post(
    Q_REHEARSALS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = StartRehearsalRequestSchema.safeParse(request.body);
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      return answer(
        request,
        reply,
        await rehearsals.start(
          getActorContext(request),
          body.data.investorOrganisationId,
          body.data.length,
        ),
      );
    },
  );

  app.get(
    Q_INVESTOR_REHEARSALS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = InvestorParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      void reply.header("Cache-Control", "no-store");
      return QRehearsalListDtoSchema.parse(
        await rehearsals.list(
          getActorContext(request),
          params.data.investorOrganisationId,
        ),
      );
    },
  );

  app.get(
    Q_REHEARSAL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      return answer(
        request,
        reply,
        await rehearsals.get(getActorContext(request), params.data.rehearsalId),
      );
    },
  );

  app.post(
    Q_REHEARSAL_TURNS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const body = RehearsalTurnRequestSchema.safeParse(request.body);
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      return answer(
        request,
        reply,
        await rehearsals.say(
          getActorContext(request),
          params.data.rehearsalId,
          body.data.text,
        ),
      );
    },
  );

  app.post(
    Q_REHEARSAL_FINISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      return answer(
        request,
        reply,
        await rehearsals.finish(
          getActorContext(request),
          params.data.rehearsalId,
        ),
      );
    },
  );
}
