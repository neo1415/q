import type { FastifyInstance } from "fastify";

import {
  parseContract,
  Q_PITCH_QA_MATCH_PATH,
  QPitchQaMatchRequestSchema,
  QPitchQaMatchResponseSchema,
} from "@capital-q/contracts";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import type { QPitchQaMatcher } from "../composition/q-pitch-qa.js";
import {
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `POST /v1/q-pitch/qa/match` (Q Story ending): which prepared answer, if
 * any, a spoken question after the story means. Reads public product copy
 * only and changes nothing, so it needs no idempotency key; it still needs a
 * signed-in person, because it spends a provider call.
 */
export function registerQPitchQaRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly identity?: ApplicationIdentityLookup | undefined;
    readonly match: QPitchQaMatcher;
  },
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  app.post(
    Q_PITCH_QA_MATCH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        QPitchQaMatchRequestSchema,
        request.body ?? {},
        "That question is not valid.",
      );
      const decided = await dependencies.match(body);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QPitchQaMatchResponseSchema.parse(decided));
    },
  );
}
