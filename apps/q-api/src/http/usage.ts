import type { FastifyInstance } from "fastify";

import { Q_USAGE_PATH, QUsageDtoSchema } from "@capital-q/contracts";

import type { OwnUsage } from "../composition/usage.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/** GET /v1/q/usage: the person's own usage this month. Read-only. */
export function registerUsageRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & { readonly usage: OwnUsage },
): void {
  const withContext = requireActorContextHook(dependencies);
  app.get(Q_USAGE_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    void reply.header("Cache-Control", "no-store");
    return QUsageDtoSchema.parse(await dependencies.usage(actor));
  });
}
