import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_WORKFORCE_JOB_PATH,
  Q_WORKFORCE_JOBS_PATH,
  WorkforceJobDetailDtoSchema,
  WorkforceJobListDtoSchema,
  WorkforceJobListQuerySchema,
} from "@capital-q/contracts";

import type { WorkforcePage } from "../composition/workforce/page.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Q's workforce, for the person (founder brief J5): their own jobs, and
 * one job's agents, drafts, grades and timeline. Read-only. Ids in paths
 * are input: every call answers only for the person's own jobs, and
 * someone else's id is the same 404 as one that does not exist. Approving,
 * editing or rejecting an offered draft is the Approval Engine's own
 * route; its decisions feed the agents' learning (J3).
 */

export type WorkforceRoutesDependencies = ActorContextDependencies & {
  readonly page: WorkforcePage;
};

const JobParams = z.object({ jobId: z.string().uuid() }).strict();

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code: "RESOURCE_NOT_FOUND" | "VALIDATION_FAILED",
) {
  const details = createProblemDetails({
    code,
    requestId: request.id,
    detail:
      code === "RESOURCE_NOT_FOUND"
        ? "Not found."
        : "The request is not valid.",
  });
  return reply
    .status(details.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(details);
}

export function registerWorkforceRoutes(
  app: FastifyInstance,
  dependencies: WorkforceRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { page } = dependencies;

  app.get(
    Q_WORKFORCE_JOBS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const query = WorkforceJobListQuerySchema.safeParse(request.query ?? {});
      if (!query.success) return problem(request, reply, "VALIDATION_FAILED");
      const list = await page.list(
        { tenantId: actor.tenantId, userId: actor.userId },
        { cursor: query.data.cursor, limit: query.data.limit },
      );
      void reply.header("Cache-Control", "no-store");
      return WorkforceJobListDtoSchema.parse(list);
    },
  );

  app.get(
    Q_WORKFORCE_JOB_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const params = JobParams.safeParse(request.params);
      if (!params.success) return problem(request, reply, "RESOURCE_NOT_FOUND");
      const detail = await page.detail(
        { tenantId: actor.tenantId, userId: actor.userId },
        params.data.jobId,
      );
      if (detail === null) return problem(request, reply, "RESOURCE_NOT_FOUND");
      void reply.header("Cache-Control", "no-store");
      return WorkforceJobDetailDtoSchema.parse(detail);
    },
  );
}
