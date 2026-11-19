import type { FastifyInstance } from "fastify";

import {
  Q_API_OPS_POOL_PATH,
  QApiOpsPoolDtoSchema,
  type ServicePoolDto,
} from "@capital-q/contracts";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import {
  getActorContext,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

export type OpsPoolDependencies = {
  /** The process's pool snapshot; null when it has no watched pool. */
  readonly pool: () => ServicePoolDto | null;
  /** Whether this person is a platform operator holding overview.read. */
  readonly isOperator: (userId: string) => Promise<boolean>;
};

/**
 * GET /v1/ops/pool: q-api's database pool for the operations console's
 * System health (incident 19 Nov 2026: the pool wedged for 72 minutes).
 * Counts and ages only. The session must be a platform operator holding
 * overview.read, decided by the platform-admin grants in the database;
 * everyone else, signed in or not, gets the same 404 as any console read.
 * The public readiness answer is unchanged and says nothing of the pool.
 */
export function registerOpsPoolRoute(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly identity: ApplicationIdentityLookup;
    readonly ops: OpsPoolDependencies;
  },
): void {
  const withContext = requireActorContextOrPersonalHook(dependencies);
  app.get(
    Q_API_OPS_POOL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      void reply.header("Cache-Control", "no-store");
      if (!(await dependencies.ops.isOperator(actor.userId))) {
        return reply.status(404).send({
          type: "about:blank",
          title: "Not found",
          status: 404,
        });
      }
      return QApiOpsPoolDtoSchema.parse({ pool: dependencies.ops.pool() });
    },
  );
}
