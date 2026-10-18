import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_ERRAND_PATH,
  Q_RELATIONSHIP_ERRANDS_PATH,
  QErrandListDtoSchema,
  QErrandStoppedDtoSchema,
} from "@capital-q/contracts";

import type { ErrandRunner } from "../composition/errands.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Errands (founder direction 2026-09-29): the person reads their own
 * errands on one relationship and stops one. Ids are input; the runner
 * answers only for the errand's own person and tenant, so someone else's
 * errand is an empty list or the same 404 as one that does not exist.
 */

export type ErrandRoutesDependencies = ActorContextDependencies & {
  readonly errands: Pick<ErrandRunner, "list" | "stop">;
};

const ListParamsSchema = z
  .object({ relationshipId: z.string().uuid() })
  .strict();
const StopParamsSchema = z.object({ errandId: z.string().uuid() }).strict();

export function registerErrandRoutes(
  app: FastifyInstance,
  dependencies: ErrandRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { errands } = dependencies;

  app.get(
    Q_RELATIONSHIP_ERRANDS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ListParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const rows = await errands.list(
        getActorContext(request),
        params.data.relationshipId,
      );
      void reply.header("Cache-Control", "no-store");
      return QErrandListDtoSchema.parse({
        errands: rows.map((row) => ({
          id: row.id,
          counterpartName: row.counterpart_name,
          status: row.status,
          lastStep: row.last_step,
          failure: row.failure,
          createdAt: row.created_at.toISOString(),
        })),
      });
    },
  );

  app.delete(
    Q_ERRAND_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = StopParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const stopped = await errands.stop(
        getActorContext(request),
        params.data.errandId,
      );
      if (!stopped) {
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
      void reply.header("Cache-Control", "no-store");
      return QErrandStoppedDtoSchema.parse({ stopped: true });
    },
  );
}
