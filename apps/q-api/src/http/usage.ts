import type { FastifyInstance } from "fastify";

import {
  Q_USAGE_PATH,
  QUsageDtoSchema,
  QUsageQuerySchema,
} from "@capital-q/contracts";

import type { OwnUsage } from "../composition/usage.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * GET /v1/q/usage: the person's own usage this month, or last month with
 * `?month=previous`. Read-only.
 */
export function registerUsageRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & { readonly usage: OwnUsage },
): void {
  const withContext = requireActorContextHook(dependencies);
  app.get(Q_USAGE_PATH, { onRequest: withContext }, async (request, reply) => {
    const query = QUsageQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        type: "about:blank",
        title: "Invalid request",
        status: 400,
        detail: "month is current or previous.",
      });
    }
    const actor = getActorContext(request);
    void reply.header("Cache-Control", "no-store");
    return QUsageDtoSchema.parse(
      await dependencies.usage(actor, { month: query.data.month }),
    );
  });
}
