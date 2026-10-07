import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  READINESS_PATH,
  ReadinessDtoSchema,
} from "@capital-q/contracts";
import type { ReadinessService } from "@capital-q/readiness";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The founder's own readiness (Q.03), action plan (Q.04) and Q's
 * follow-up questions (Q.01). A read; its mutations are declared actions
 * (app-actions `readiness.*`). The company comes from the server-resolved
 * context only, never from the request; anyone without a company of
 * their own (an investor included) gets the same 404 (Context Firewall).
 */

export type ReadinessRoutesDependencies = ActorContextDependencies & {
  readonly readiness: Pick<ReadinessService, "read">;
};

export function registerReadinessRoutes(
  app: FastifyInstance,
  dependencies: ReadinessRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(
    READINESS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const read = await dependencies.readiness.read(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      if (read === null) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
          detail: "Readiness is for a founder's own company.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      return ReadinessDtoSchema.parse(read);
    },
  );
}
