import type { RelationshipStateProjector } from "@capital-q/network";
import { RELATIONSHIP_PROJECTOR_VERSION } from "@capital-q/network";

import type { RunnerLogger } from "../outbox-runner.js";

/**
 * At worker start, the relationship states a new projector version reads
 * differently are re-folded from history (relationship-state.v2, lead
 * 2026-10-02: the hosted database cannot be reached by an operator script),
 * just as the slate version-drift rebuild runs at start.
 *
 * Only what is behind: a cache folded by an older projector version, or a
 * relationship whose history the cache has not caught up with (a never-
 * projected one included). Bounded per start and batched; every write is
 * the projector's compare-and-set, so a second start changes nothing and a
 * concurrent event projection is never overwritten. Never blocks start and
 * never throws: a failure is logged, and the next start tries again.
 */

export const RELATIONSHIP_REBUILD_AT_START_MAX = 20_000;

export async function rebuildRelationshipStatesAtStart(options: {
  readonly projector: Pick<RelationshipStateProjector, "rebuild">;
  readonly logger: RunnerLogger;
  readonly max?: number | undefined;
}): Promise<void> {
  try {
    const result = await options.projector.rebuild({
      batchSize: 200,
      max: options.max ?? RELATIONSHIP_REBUILD_AT_START_MAX,
    });
    options.logger.info(
      { projector: RELATIONSHIP_PROJECTOR_VERSION, ...result },
      "network.relationship_states.rebuilt_at_start",
    );
  } catch (error: unknown) {
    options.logger.warn(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "network.relationship_states.rebuild_at_start_failed",
    );
  }
}
