import type { FastifyInstance } from "fastify";

import {
  parseContract,
  Q_FAST_NAVIGATION_PATH,
  QFastNavigationRequestSchema,
  QFastNavigationResponseSchema,
} from "@capital-q/contracts";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import type { FastNavigationResolver } from "../composition/fast-navigation.js";
import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `POST /v1/q/navigation/resolve` (RECOVERY-2026-10, C): where the person's
 * finished sentence goes, read by code as the person, for the screen to
 * move before Q has answered. Reads only; it changes nothing, so it needs
 * no idempotency key. The actor is resolved on the server; the words are
 * theirs, as in a run.
 */
export function registerFastNavigationRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly identity?: ApplicationIdentityLookup | undefined;
    readonly resolve: FastNavigationResolver;
  },
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });

  app.post(
    Q_FAST_NAVIGATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        QFastNavigationRequestSchema,
        request.body ?? {},
        "That navigation request is not valid.",
      );
      const decided = await dependencies.resolve(
        getActorContext(request),
        body.text,
      );
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QFastNavigationResponseSchema.parse(decided));
    },
  );
}
