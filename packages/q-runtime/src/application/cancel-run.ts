import {
  Q_RUN_MESSAGES_MAX,
  toPublicQFailure,
  type CorrelationId,
  type QRunId,
  type QRunSummary,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { toQRunSummary, type QRunRecord } from "../contracts/index.js";
import {
  QRunAlreadyTerminalError,
  QRunNotFoundError,
  QRunVersionConflictError,
} from "../domain/errors.js";
import { assertTransition, decideCancellation } from "../domain/lifecycle.js";
import { refuseRunIfForeign } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";
import { appendRunEvent } from "./run-events.js";

export type CancelQRunCommand = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
};

export type CancelQRunResult = {
  readonly run: QRunRecord;
  /** False when the run was already cancelled or being cancelled. */
  readonly changed: boolean;
  readonly summary: QRunSummary;
};

/**
 * Cancel a run, deterministically and idempotently.
 *
 * The run is locked, the lifecycle policy decides, and the move is applied
 * under the version that was read — so two cancels, or a cancel racing an
 * orchestrator's transition, resolve to one valid outcome rather than two
 * writers each believing they won.
 *
 *   nothing in flight  -> CANCELLED now, with a q.run.failed event carrying
 *                         the public "cancelled" projection
 *   work in flight     -> CANCEL_REQUESTED; the orchestrator (CQ-Q-003)
 *                         stops cooperatively and records the end
 *   already cancelling -> no change, no duplicate event
 *   otherwise terminal -> refused: there is nothing to cancel
 *
 * Nothing here can interrupt an external call, because none is made yet.
 */
export function createCancelQRun(dependencies: QRuntimeDependencies) {
  const { transactions, repositories } = dependencies;

  return async (command: CancelQRunCommand): Promise<CancelQRunResult> => {
    const { actor } = command;

    return transactions.run(async (tx) => {
      const run = await repositories.runs.lockForActor(
        tx,
        actor.tenantId,
        actor.userId,
        command.runId,
      );
      if (run === null) {
        await refuseRunIfForeign(
          dependencies,
          tx.sql,
          actor,
          command.runId,
          command.correlationId,
        );
        throw new QRunNotFoundError();
      }

      const decision = decideCancellation(run.status);
      const finish = async (
        current: QRunRecord,
        changed: boolean,
      ): Promise<CancelQRunResult> => {
        const messages = await repositories.messages.listForRun(
          tx.sql,
          current.tenantId,
          current.id,
          Q_RUN_MESSAGES_MAX,
        );
        return {
          run: current,
          changed,
          summary: toQRunSummary(current, messages, null),
        };
      };

      switch (decision.kind) {
        case "ALREADY_CANCELLING":
          return finish(run, false);

        case "ALREADY_TERMINAL":
          throw new QRunAlreadyTerminalError(run.status);

        case "CANCEL_NOW": {
          assertTransition(run.status, "CANCELLED");
          const cancelled = await repositories.runs.transition(tx, {
            tenantId: run.tenantId,
            runId: run.id,
            expectedVersion: run.version,
            status: "CANCELLED",
            completedAt: new Date().toISOString(),
            failureCode: "RUN_CANCELLED",
          });
          if (cancelled === null) {
            throw new QRunVersionConflictError();
          }
          await appendRunEvent(repositories, tx, cancelled, {
            type: "q.run.failed",
            data: {
              status: "CANCELLED",
              failure: toPublicQFailure(
                { diagnosticCode: "RUN_CANCELLED" },
                { runId: cancelled.id },
              ),
            },
          });
          dependencies.logger?.info(
            {
              qRunId: cancelled.id,
              status: cancelled.status,
              correlationId: command.correlationId,
            },
            "q run cancelled",
          );
          return finish(cancelled, true);
        }

        case "REQUEST_CANCEL": {
          assertTransition(run.status, "CANCEL_REQUESTED");
          const requested = await repositories.runs.transition(tx, {
            tenantId: run.tenantId,
            runId: run.id,
            expectedVersion: run.version,
            status: "CANCEL_REQUESTED",
          });
          if (requested === null) {
            throw new QRunVersionConflictError();
          }
          dependencies.logger?.info(
            {
              qRunId: requested.id,
              status: requested.status,
              correlationId: command.correlationId,
            },
            "q run cancellation requested",
          );
          return finish(requested, true);
        }
      }
    });
  };
}
