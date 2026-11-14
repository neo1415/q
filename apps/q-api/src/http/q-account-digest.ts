import type { FastifyInstance } from "fastify";

import {
  Q_ACCOUNT_DIGEST_PATH,
  QAccountDigestSchema,
} from "@capital-q/contracts";
import type { AccountDigestReader } from "@capital-q/q-tools";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Owner 14 Nov 2026: the person's own account digest -- the same assembly
 * every Q turn reads -- for the resume opening ("what is waiting") and any
 * page that wants Q's picture of the account. The resolved actor only;
 * nothing in the request names whose digest it is.
 */
export type AccountDigestRoutesDependencies = ActorContextDependencies & {
  readonly accountDigest: AccountDigestReader;
};

export function registerAccountDigestRoutes(
  app: FastifyInstance,
  dependencies: AccountDigestRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  app.get(
    Q_ACCOUNT_DIGEST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const digest = await dependencies.accountDigest(actor, {
        now: new Date(),
      });
      void reply.header("Cache-Control", "no-store");
      return QAccountDigestSchema.parse(digest);
    },
  );
}
