import type { Logger } from "@capital-q/observability";

import { digestOf } from "./digest.js";
import type { InstructionEngine } from "./engine.js";
import type { InstructionStore } from "./store.js";

/**
 * When a standing instruction runs (ADR 0043 S4): on its cadence (every
 * four hours by default), as soon as it is approved, when something
 * happens on a relationship Q has worked on for it, and when a chat
 * message lands on a relationship it covers (QA run 8a1d57b9). Each firing is claimed
 * in the database first, so instances never double-fire; outside the
 * person's working hours it is deferred, not planned.
 */

const CLAIM_LIMIT = 10;
const OUTSIDE_HOURS_RETRY_MINUTES = 30;

export function createInstructionTriggers(dependencies: {
  readonly store: Pick<InstructionStore, "claimDue" | "defer" | "wakeFor"> &
    Partial<
      Pick<
        InstructionStore,
        | "claimDigestDue"
        | "stepsSince"
        | "instruction"
        | "notify"
        | "wakeForChat"
        | "wakeForNewCompany"
        | "resolveAnswered"
      >
    >;
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
    await digests().catch((error: unknown) => {
      logger?.warn({ err: error }, "standing instruction digests failed");
    });
    // QA run 8a1d57b9: a "needs your yes" notice whose cards are all
    // answered (or rejected) stops asking for attention.
    await store.resolveAnswered?.().catch((error: unknown) => {
      logger?.warn({ err: error }, "standing instruction notices not resolved");
    });
    return due.length;
  };

  /** S7: each due digest, once, from the recorded steps. */
  const digests = async (): Promise<void> => {
    if (
      store.claimDigestDue === undefined ||
      store.stepsSince === undefined ||
      store.instruction === undefined ||
      store.notify === undefined
    ) {
      return;
    }
    for (const claim of await store.claimDigestDue(CLAIM_LIMIT)) {
      const row = await store.instruction(claim.id);
      if (row === null) continue;
      const digest = digestOf(
        row.goal_text,
        await store.stepsSince(claim.id, claim.since),
      );
      if (digest === null) continue;
      await store.notify({
        instruction: row,
        key: `digest:${claim.claimed_at.toISOString()}`,
        title: digest.title,
        body: digest.body,
        priority: "UPDATE",
      });
    }
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
    /**
     * QA run 8a1d57b9: a chat message on the relationship wakes the ACTIVE
     * instructions covering it on the receiving side, at once.
     */
    wakeChat: async (relationshipId: string): Promise<number> => {
      if (store.wakeForChat === undefined) return 0;
      const woken = await store.wakeForChat(relationshipId);
      if (woken > 0) void sweep().catch(() => undefined);
      return woken;
    },
    /** A company became ready: instructions open to new companies run soon. */
    wakeNewCompany: async (companyId: string): Promise<number> => {
      if (store.wakeForNewCompany === undefined) return 0;
      return store.wakeForNewCompany(companyId);
    },
  };
}

export type InstructionTriggers = ReturnType<typeof createInstructionTriggers>;
