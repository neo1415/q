import type { Logger } from "@capital-q/observability";

import type {
  HeldRetryResult,
  InstructionEngine,
} from "../instructions/engine.js";
import type { Owner, WorkforceStore } from "./store.js";

/**
 * "Ask Q to try again" on a held message, and the automatic second look
 * at holds the reviewer could not grade (Zino, 2026-10-08).
 *
 * Live 2026-10-07 15:43: the Spheros draft was held as REVIEW_UNAVAILABLE
 * because the reviewer's long note failed its schema (INVALID_MODEL_OUTPUT);
 * the fix that trims notes by code (3c9fc1cc) shipped the next morning, but
 * a hold made before it stays a hold. Such a hold is written and reviewed
 * again once, automatically; any hold can be retried by the person.
 *
 * A pass is offered as an approval card, never sent: the person approves
 * the exact text through the Approval Engine. Only holds from a standing
 * instruction can be rewritten here (every hold so far); others answer
 * NOT_SUPPORTED and keep Send as is / Edit & send.
 */

export type HeldRetryAnswer =
  | HeldRetryResult
  | {
      readonly outcome: "UNAVAILABLE";
      readonly reason: "NOT_FOUND" | "NOT_HELD" | "NOT_SUPPORTED";
    };

export type StaleHold = {
  readonly tenantId: string;
  readonly userId: string;
  readonly draftId: string;
};

export function createHeldRetry(dependencies: {
  readonly store: Pick<WorkforceStore, "draft" | "job">;
  readonly engine: () => Pick<InstructionEngine, "retryHeld"> | undefined;
  /** Holds the reviewer could not grade, not yet looked at again. */
  readonly staleHolds?:
    ((limit: number) => Promise<readonly StaleHold[]>) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store, logger } = dependencies;
  // One retry per press: a repeated request joins the one in flight.
  const inFlight = new Map<string, Promise<HeldRetryAnswer>>();

  const run = async (
    owner: Owner,
    input: {
      readonly draftId: string;
      readonly relationshipId: string | null;
      readonly idempotencyKey: string;
    },
  ): Promise<HeldRetryAnswer> => {
    const draft = await store.draft(owner, input.draftId);
    if (draft === null) return { outcome: "UNAVAILABLE", reason: "NOT_FOUND" };
    if (draft.outcome !== "HELD") {
      return { outcome: "UNAVAILABLE", reason: "NOT_HELD" };
    }
    const job = await store.job(owner, draft.job_id);
    const engine = dependencies.engine();
    if (
      job === null ||
      job.job.source_kind !== "INSTRUCTION" ||
      job.job.source_id === null ||
      engine === undefined
    ) {
      return { outcome: "UNAVAILABLE", reason: "NOT_SUPPORTED" };
    }
    // A later message to the same person already superseded this one.
    const later = job.drafts.some(
      (other) =>
        other.id !== draft.id &&
        other.counterpart_name === draft.counterpart_name &&
        other.created_at.getTime() > draft.created_at.getTime(),
    );
    if (later) return { outcome: "UNAVAILABLE", reason: "NOT_HELD" };
    return engine.retryHeld({
      instructionId: job.job.source_id,
      userId: owner.userId,
      relationshipId: input.relationshipId,
      counterpartName: draft.counterpart_name,
      draftId: draft.id,
      body: draft.body,
      idempotencyKey: input.idempotencyKey,
    });
  };

  const retry = (
    owner: Owner,
    input: {
      readonly draftId: string;
      readonly relationshipId: string | null;
      readonly idempotencyKey: string;
    },
  ): Promise<HeldRetryAnswer> => {
    const key = `${owner.tenantId}:${owner.userId}:${input.draftId}:${input.idempotencyKey}`;
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const next = run(owner, input).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, next);
    return next;
  };

  return {
    retry,
    /**
     * Holds the reviewer could not grade, looked at again once each (on
     * start). Bounded; a failure is logged and never stops the service.
     */
    sweepStale: async (limit = 5): Promise<number> => {
      if (dependencies.staleHolds === undefined) return 0;
      const holds = await dependencies.staleHolds(limit).catch(() => []);
      let offered = 0;
      for (const hold of holds) {
        const answer = await retry(
          { tenantId: hold.tenantId, userId: hold.userId },
          {
            draftId: hold.draftId,
            relationshipId: null,
            idempotencyKey: "auto-review-again",
          },
        ).catch((error: unknown) => {
          logger?.warn({ err: error }, "stale hold not reviewed again");
          return null;
        });
        if (answer?.outcome === "OFFERED") offered += 1;
        logger?.info(
          { draftId: hold.draftId, outcome: answer?.outcome ?? "FAILED" },
          "stale hold reviewed again",
        );
      }
      return offered;
    },
  };
}

export type HeldRetry = ReturnType<typeof createHeldRetry>;
