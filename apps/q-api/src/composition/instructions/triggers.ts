import type { Logger } from "@capital-q/observability";

import type { InstructionEngine } from "./engine.js";
import type { InstructionStore } from "./store.js";

/**
 * When a standing instruction runs (ADR 0043 S4): on its cadence (every
 * four hours by default), as soon as it is approved, and when something
 * happens on a relationship Q has worked on for it. Each firing is claimed
 * in the database first, so instances never double-fire; outside the
 * person's working hours it is deferred, not planned.
 */

const CLAIM_LIMIT = 10;
const OUTSIDE_HOURS_RETRY_MINUTES = 30;

export function createInstructionTriggers(dependencies: {
  readonly store: Pick<InstructionStore, "claimDue" | "defer" | "wakeFor">;
  readonly engine: () => InstructionEngine | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store, logger } = dependencies;
  let running: Promise<number> | null = null;

  const pass = async (): Promise<number> => {
    const engine = dependencies.engine();
    if (engine === undefined) return 0;
    const due = await store.claimDue(CLAIM_LIMIT);
    for (const claim of due) {
      try {
        const result = await engine.fire(
          claim.id,
          `sched-${claim.claimed_at.toISOString()}`,
        );
        if (result.outcome === "OUTSIDE_HOURS") {
          await store.defer(claim.id, OUTSIDE_HOURS_RETRY_MINUTES);
          continue;
        }
        logger?.info(
          {
            instructionId: claim.id,
            outcome: result.outcome,
            done: result.done,
            asked: result.asked,
            refused: result.refused,
            cannot: result.cannot.length,
          },
          "standing instruction fired",
        );
      } catch (error: unknown) {
        logger?.warn(
          { err: error, instructionId: claim.id },
          "standing instruction firing failed",
        );
      }
    }
    return due.length;
  };

  /** One pass at a time per instance; a call during one joins it. */
  const sweep = (): Promise<number> => {
    running ??= pass().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    sweep,
    wake: async (relationshipId: string): Promise<number> => {
      const woken = await store.wakeFor(relationshipId);
      if (woken > 0) void sweep().catch(() => undefined);
      return woken;
    },
  };
}

export type InstructionTriggers = ReturnType<typeof createInstructionTriggers>;
