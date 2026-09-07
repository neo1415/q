import type { Logger } from "@capital-q/observability";
import type {
  QActionPort,
  QActionPrepareContext,
  QActionPrepareOutcome,
} from "@capital-q/q-runtime";

import {
  QActionNotPermittedError,
  QActionUnavailableError,
  QActionVersionConflictError,
} from "../domain/errors.js";
import type { QActionService } from "./service.js";

/**
 * Where a run's consequential action comes from (CQ-Q-008 §46, §113).
 *
 * The proposer decides WHETHER this run has something consequential to
 * prepare and WHAT it is; the Approval Engine decides whether it may be
 * proposed, persists it exactly, and requests the approval. A future
 * PREPARE_ONLY tool result becomes a proposer; until one exists,
 * production proposes nothing and the test proposer proposes the test
 * action. Whatever a proposer says, an unregistered or prohibited type
 * never becomes a proposal, and a proposer can never approve anything.
 */
export type QActionProposer = {
  readonly propose: (context: QActionPrepareContext) => Promise<{
    readonly actionType: string;
    readonly payload: unknown;
  } | null>;
};

export const noQActionProposer: QActionProposer = {
  propose: () => Promise.resolve(null),
};

/** The orchestration seam over the engine. */
export function createQActionPort(options: {
  readonly service: QActionService;
  readonly proposer?: QActionProposer | undefined;
  readonly logger?: Logger | undefined;
}): QActionPort {
  const proposer = options.proposer ?? noQActionProposer;
  return {
    prepare: async (context): Promise<QActionPrepareOutcome> => {
      const proposal = await proposer.propose(context);
      if (proposal === null) {
        return { kind: "NONE" };
      }
      try {
        const { action, approval } = await options.service.propose({
          actor: context.actor,
          runId: context.runId,
          correlationId: context.correlationId,
          actionType: proposal.actionType,
          payload: proposal.payload,
        });
        return {
          kind: "AWAITING_APPROVAL",
          actionId: action.id,
          approvalId: approval.id,
        };
      } catch (error: unknown) {
        // A refused proposal is not a run failure: Q simply has nothing it
        // may prepare, and the person receives the analysis alone.
        if (
          error instanceof QActionUnavailableError ||
          error instanceof QActionNotPermittedError ||
          error instanceof QActionVersionConflictError
        ) {
          options.logger?.info(
            {
              qRunId: context.runId,
              actionType: proposal.actionType,
              errorCode: error.errorCode,
            },
            "q action proposal refused",
          );
          return { kind: "NONE" };
        }
        throw error;
      }
    },
    executeApproved: (context) => options.service.executeApproved(context),
  };
}
