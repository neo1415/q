import type { FastifyInstance } from "fastify";

import {
  ProfileFindingsQuerySchema,
  Q_PROFILE_FINDINGS_PATH,
} from "@capital-q/contracts";

import type { ProfileFindingsReader } from "../composition/profile-findings.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `GET /v1/q/profile-findings` (BIZ-002): what Q found on the public web
 * about the actor's own profile subject. Thin: parse, read, map. A subject
 * that is not the actor's own, a malformed query and a denied plan are the
 * same 404, so a probe learns nothing about anybody else's subjects.
 */

export type ProfileFindingsRoutesDependencies = ActorContextDependencies & {
  readonly findings: ProfileFindingsReader;
};

export function registerProfileFindingsRoutes(
  app: FastifyInstance,
  dependencies: ProfileFindingsRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(
    Q_PROFILE_FINDINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = ProfileFindingsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.callNotFound();
      }
      const result = await dependencies.findings.read(
        getActorContext(request),
        query.data,
      );
      void reply.header("Cache-Control", "no-store");
      if (result === null) {
        return reply.callNotFound();
      }
      return result;
    },
  );
}
