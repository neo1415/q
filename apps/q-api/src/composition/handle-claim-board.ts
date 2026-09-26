import type { Logger } from "@capital-q/observability";
import {
  normaliseHandle,
  type PublicIdentityService,
} from "@capital-q/public-identity";
import type { QActionProposer } from "@capital-q/q-actions";
import type { HandleClaimPort } from "@capital-q/q-tools";

import {
  HANDLE_CLAIM,
  HandleClaimPayloadSchema,
  describeHandleClaim,
  type HandleClaimPayload,
} from "./handle-claim-action.js";

/**
 * Where `propose_handle_claim` (BIZ-004) leaves a handle for the run's
 * Approval Engine proposer. The handle is normalised and checked -- shape,
 * reserved list, availability -- before anything is held, so the person is
 * never asked to approve a handle that cannot be theirs; it is checked
 * again when the approved action executes. One prepared action per run,
 * for the run's own person and tenant; nothing on the board executes.
 */

const READING_TTL_MS = 10 * 60 * 1000;

type Prepared = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly payload: HandleClaimPayload;
  readonly at: number;
};

export type HandleClaimBoard = HandleClaimPort & {
  readonly proposer: QActionProposer;
};

export function createHandleClaimBoard(options: {
  readonly publicIdentity: Pick<PublicIdentityService, "handleAvailable">;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}): HandleClaimBoard {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<string, Prepared>();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };
  return {
    prepareHandleClaim: async (entry) => {
      sweep();
      const reading = normaliseHandle(entry.handle);
      if (!reading.ok) {
        return {
          status: "REFUSED",
          awaitingApprovalOf: null,
          reason:
            "a handle is 3 to 30 lowercase letters, digits or single hyphens, not starting or ending with a hyphen",
        };
      }
      if (!(await options.publicIdentity.handleAvailable(reading.handle))) {
        options.logger?.info(
          { qRunId: entry.runId },
          "a requested handle is not available",
        );
        return {
          status: "REFUSED",
          awaitingApprovalOf: null,
          reason: `@${reading.handle} isn't available; suggest another`,
        };
      }
      const parsed = HandleClaimPayloadSchema.safeParse({
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        handle: reading.handle,
      });
      if (!parsed.success) {
        return {
          status: "REFUSED",
          awaitingApprovalOf: null,
          reason: "that isn't something I can prepare from here",
        };
      }
      const summary = describeHandleClaim(parsed.data).summary;
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        const same =
          JSON.stringify(existing.payload) === JSON.stringify(parsed.data);
        return {
          status: same ? "PREPARED" : "ONE_PER_TURN",
          awaitingApprovalOf: same ? summary : null,
          reason: null,
        };
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        payload: parsed.data,
        at: now(),
      });
      return { status: "PREPARED", awaitingApprovalOf: summary, reason: null };
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          actionType: HANDLE_CLAIM,
          payload: entry.payload,
        });
      },
    },
  };
}
