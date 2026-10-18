import type { FastifyInstance } from "fastify";

import {
  BriefingCommandRequestSchema,
  BriefingCommandResultDtoSchema,
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_BRIEFING_COMMAND_PATH,
} from "@capital-q/contracts";

import type { BriefingCommandReader } from "../composition/briefing-command.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The arrival briefing's free-form words, read into card verbs for the
 * person's own browser (Zino, 2026-10-08). Changes nothing: the verbs are
 * run, and checked, by the card sequence on their screen.
 */
export function registerBriefingCommandRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly read: BriefingCommandReader;
  },
): void {
  const withContext = requireActorContextHook(dependencies);
  app.post(
    Q_BRIEFING_COMMAND_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const body = BriefingCommandRequestSchema.safeParse(request.body);
      if (!body.success) {
        const problem = createProblemDetails({
          code: "VALIDATION_FAILED",
          requestId: request.id,
          detail: "The request is not valid.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const result = await dependencies.read(
        { tenantId: actor.tenantId, userId: actor.userId },
        body.data,
      );
      void reply.header("Cache-Control", "no-store");
      return BriefingCommandResultDtoSchema.parse(result);
    },
  );
}
