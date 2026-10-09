import type { DatabaseExecutor } from "@capital-q/database";

import type { ActorContext } from "../actor-context/actor-context.js";

/**
 * Reads the two access fingerprints a cached Q context is keyed by
 * (migration 20261220193000; K Part 11). Read once per request, never
 * cached across requests: their whole point is to change the moment
 * access does.
 */
export type ContextEpochReader = {
  readonly actorEpoch: (actor: ActorContext) => Promise<string>;
  readonly subjectEpoch: (
    companyId: string,
    viewerOrganisationId: string | undefined,
  ) => Promise<string>;
};

export function createPostgresContextEpochReader(options: {
  readonly sql: DatabaseExecutor;
}): ContextEpochReader {
  return {
    actorEpoch: async (actor) => {
      const rows = await options.sql<{ epoch: string }[]>`
        select private.actor_authz_epoch(
                 ${actor.userId}::uuid, ${actor.tenantId}::uuid,
                 ${actor.membershipId ?? null}::uuid) as epoch`;
      const epoch = rows[0]?.epoch;
      if (epoch === undefined) throw new Error("actor epoch unavailable");
      return epoch;
    },
    subjectEpoch: async (companyId, viewerOrganisationId) => {
      const rows = await options.sql<{ epoch: string }[]>`
        select private.subject_access_epoch(
                 ${companyId}::uuid, ${viewerOrganisationId ?? null}::uuid) as epoch`;
      const epoch = rows[0]?.epoch;
      if (epoch === undefined) throw new Error("subject epoch unavailable");
      return epoch;
    },
  };
}
