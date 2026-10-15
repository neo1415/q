import {
  RelationshipIdSchema,
  type RelationshipId,
} from "../contracts/index.js";
import {
  projectRelationshipState,
  RELATIONSHIP_PROJECTOR_VERSION,
  type RelationshipProjection,
} from "../domain/state-projector.js";
import type { NetworkServiceDependencies } from "./dependencies.js";
import { readHistory } from "./relationship-history.js";
import { partyView } from "./relationship-status.js";
import {
  createPostgresRelationshipPartyStates,
  type RelationshipPartyStateRepository,
} from "../infrastructure/postgres-relationship-party-states.js";

// Kept here too for older importers; the history read lives on its own so
// the per-party fold (relationship-status) can use it without a cycle.
export { readHistory } from "./relationship-history.js";

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

export type RelationshipStateProjector = {
  readonly project: (relationshipId: RelationshipId) => Promise<{
    readonly projection: RelationshipProjection | null;
    readonly changed: boolean;
    /** The CRM pipeline read model's write; FAILED is repaired on read. */
    readonly readModel?: "WRITTEN" | "FAILED" | undefined;
  }>;
  readonly rebuild: (options?: {
    /** Re-fold every relationship, not only those whose cache is behind. */
    readonly all?: boolean | undefined;
    readonly batchSize?: number | undefined;
    /** At most this many relationships in one run; the next run continues. */
    readonly max?: number | undefined;
  }) => Promise<{
    readonly scanned: number;
    readonly changed: number;
    readonly anomalies: number;
    /**
     * The CRM pipeline read model's backfill in the same run: relationships
     * whose per-party folds were missing or behind, folded again. Null: the
     * pass could not run (e.g. its migration not applied); never fatal.
     */
    readonly readModel?: { readonly folded: number } | null | undefined;
  }>;
};

export function createRelationshipStateProjector(
  dependencies: Pick<NetworkServiceDependencies, "sql" | "repositories"> & {
    /** The CRM pipeline read model (slice 3b); the Postgres one by default. */
    readonly partyStates?: RelationshipPartyStateRepository | undefined;
  },
): RelationshipStateProjector {
  const { sql, repositories } = dependencies;
  const partyStates =
    dependencies.partyStates ?? createPostgresRelationshipPartyStates();

  /**
   * Each party's own fold for the CRM pipeline, from the same history, each
   * compare-and-set on how far the history reached. Never fails the
   * relationship's own projection: the read model is derived and the
   * pipeline repairs a missing or stale row when it reads (a deployment
   * ahead of its migration only loses the faster path).
   */
  async function writePartyStates(
    relationshipId: RelationshipId,
    history: Awaited<ReturnType<typeof readHistory>>,
  ): Promise<"WRITTEN" | "FAILED"> {
    try {
      const sourceSequence = history.at(-1)?.sequence ?? 0;
      for (const party of ["INVESTOR", "COMPANY"] as const) {
        await partyStates.upsert(sql, {
          relationshipId,
          party,
          view: partyView(history, party),
          sourceSequence,
          version: RELATIONSHIP_PROJECTOR_VERSION,
        });
      }
      return "WRITTEN";
    } catch {
      return "FAILED";
    }
  }

  /**
   * The read model's own backfill (slice 3b follow-up): relationships the
   * cache pass did not touch but whose per-party folds are missing or
   * behind. Bounded by the same budget; each write compare-and-set; a
   * failure only ends this pass.
   */
  async function backfillPartyStates(
    limit: number,
    max: number,
  ): Promise<{ readonly folded: number } | null> {
    let folded = 0;
    let after: string | null = null;
    try {
      for (;;) {
        const ids = await partyStates.behindAll(sql, {
          after,
          limit,
          version: RELATIONSHIP_PROJECTOR_VERSION,
        });
        for (const raw of ids) {
          if (folded >= max) return { folded };
          const id = RelationshipIdSchema.parse(raw);
          if (
            (await writePartyStates(
              id,
              await readHistory(dependencies, id),
            )) === "FAILED"
          )
            return { folded };
          folded += 1;
        }
        const last = ids.at(-1);
        if (ids.length < limit || last === undefined) return { folded };
        after = last;
      }
    } catch {
      return null;
    }
  }

  const project: RelationshipStateProjector["project"] = async (
    relationshipId,
  ) => {
    const history = await readHistory(dependencies, relationshipId);
    const readModel = await writePartyStates(relationshipId, history);
    const projection = projectRelationshipState(history);
    if (projection === null)
      return { projection: null, changed: false, readModel };
    const changed = await repositories.relationships.recordProjection(sql, {
      relationshipId,
      state: projection.state,
      stateSince: projection.stateSince,
      throughSequence: projection.throughSequence,
      version: projection.version,
    });
    return { projection, changed, readModel };
  };

  return {
    project,
    rebuild: async (options = {}) => {
      const limit = Math.min(Math.max(options.batchSize ?? 200, 1), 1000);
      const max = options.max ?? Number.POSITIVE_INFINITY;
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
          if (scanned >= max) break;
          const result = await project(id);
          scanned += 1;
          if (result.changed) changed += 1;
          anomalies += result.projection?.anomalies.length ?? 0;
        }
        const last = ids.at(-1);
        if (ids.length < limit || last === undefined || scanned >= max) break;
        after = last;
      }
      return {
        scanned,
        changed,
        anomalies,
        readModel: await backfillPartyStates(limit, max),
      };
    },
  };
}
