import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ADMIN_ATTRIBUTION_PATH,
  ADMIN_DISPUTES_PATH,
  ADMIN_OVERVIEW_PATH,
  ADMIN_PAUSED_PATH,
  ADMIN_REINSTATE_PATH,
  PausedListDtoSchema,
  ReinstatedDtoSchema,
  UuidSchema,
  AdminOverviewDtoSchema,
  AttributionListDtoSchema,
  createProblemDetails,
  DisputeListDtoSchema,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";
import type { PlatformAdmin } from "@capital-q/platform-admin";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Capital Q's admin console. The platform-admin check is the service's,
 * from the server-only admin table; anyone else gets the same 404 as a
 * path that does not exist, so the console is not even discoverable.
 */

export type AdminRoutesDependencies = ActorContextDependencies & {
  readonly admin: PlatformAdmin;
};

function notFound(request: FastifyRequest, reply: FastifyReply) {
  const problem = createProblemDetails({
    code: "RESOURCE_NOT_FOUND",
    requestId: request.id,
    detail: "Not found.",
  });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { admin } = dependencies;

  app.get(
    ADMIN_OVERVIEW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const overview = await admin.overview(getActorContext(request).userId);
      if (overview === null) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return AdminOverviewDtoSchema.parse(overview);
    },
  );

  app.get(
    ADMIN_ATTRIBUTION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rows = await admin.attribution(getActorContext(request).userId);
      if (rows === null) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return AttributionListDtoSchema.parse({ rows });
    },
  );

  app.get(
    ADMIN_DISPUTES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rows = await admin.disputes(getActorContext(request).userId);
      if (rows === null) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return DisputeListDtoSchema.parse({ rows });
    },
  );

  app.get(
    ADMIN_PAUSED_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rows = await admin.paused(getActorContext(request).userId);
      if (rows === null) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return PausedListDtoSchema.parse({ rows });
    },
  );

  // An operator lifts a pause Q put on an account (founder direction
  // 2026-09-30). Anyone else gets the same 404 as for the whole console.
  app.post(
    ADMIN_REINSTATE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = request.params as { readonly userId?: unknown };
      const paused = UuidSchema.safeParse(params.userId);
      if (!paused.success) return notFound(request, reply);
      const done = await admin.reinstate(
        getActorContext(request).userId,
        paused.data,
      );
      if (done !== true) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return ReinstatedDtoSchema.parse({ reinstated: true });
    },
  );
}
