import type { RelationshipEvent, RelationshipId } from "../contracts/index.js";
import {
  projectRelationshipState,
  RELATIONSHIP_PROJECTOR_VERSION,
  type RelationshipProjection,
} from "../domain/state-projector.js";
import type { NetworkServiceDependencies } from "./dependencies.js";

/**
 * The relationship state projector at work (CQ-NET-012).
 *
 * `project` re-reads the whole ordered history of one relationship and
 * folds it with the pure projector; it never trusts the event that woke it,
 * so duplicate and out-of-order deliveries converge on the same state. The
 * cached `current_state` is written with a compare-and-set on how far the
 * fold reached, so a slow projection can never overwrite a newer one.
 * `rebuild` does the same for every relationship (or only those behind),
 * which is how a new projector version is rolled out: from history.
 */

const EVENT_PAGE = 500;

export type RelationshipStateProjector = {
  readonly project: (relationshipId: RelationshipId) => Promise<{
    readonly projection: RelationshipProjection | null;
    readonly changed: boolean;
  }>;
  readonly rebuild: (options?: {
    /** Re-fold every relationship, not only those whose cache is behind. */
    readonly all?: boolean | undefined;
    readonly batchSize?: number | undefined;
  }) => Promise<{
    readonly scanned: number;
    readonly changed: number;
    readonly anomalies: number;
  }>;
};

/** The whole ordered history of one relationship, page by page. */
export async function readHistory(
  dependencies: Pick<NetworkServiceDependencies, "sql" | "repositories">,
  relationshipId: RelationshipId,
): Promise<readonly RelationshipEvent[]> {
  const out: RelationshipEvent[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = await dependencies.repositories.events.listByRelationship(
      dependencies.sql,
      relationshipId,
      { afterSequence, limit: EVENT_PAGE },
    );
    out.push(...page);
    const last = page.at(-1);
    if (page.length < EVENT_PAGE || last === undefined) return out;
    afterSequence = last.sequence;
  }
}

export function createRelationshipStateProjector(
  dependencies: Pick<NetworkServiceDependencies, "sql" | "repositories">,
): RelationshipStateProjector {
  const { sql, repositories } = dependencies;

  const project: RelationshipStateProjector["project"] = async (
    relationshipId,
  ) => {
    const history = await readHistory(dependencies, relationshipId);
    const projection = projectRelationshipState(history);
    if (projection === null) return { projection: null, changed: false };
    const changed = await repositories.relationships.recordProjection(sql, {
      relationshipId,
      state: projection.state,
      stateSince: projection.stateSince,
      throughSequence: projection.throughSequence,
      version: projection.version,
    });
    return { projection, changed };
  };

  return {
    project,
    rebuild: async (options = {}) => {
      const limit = Math.min(Math.max(options.batchSize ?? 200, 1), 1000);
      let after: RelationshipId | null = null;
      let scanned = 0;
      let changed = 0;
      let anomalies = 0;
      for (;;) {
        const ids = await repositories.relationships.listIdsForProjection(sql, {
          after,
          limit,
          onlyBehind: options.all !== true,
          version: RELATIONSHIP_PROJECTOR_VERSION,
        });
        for (const id of ids) {
          const result = await project(id);
          scanned += 1;
          if (result.changed) changed += 1;
          anomalies += result.projection?.anomalies.length ?? 0;
        }
        const last = ids.at(-1);
        if (ids.length < limit || last === undefined) break;
        after = last;
      }
      return { scanned, changed, anomalies };
    },
  };
}
