import type {
  CorrelationId,
  QActionProposalId,
  QRunId,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  QOrchestrationVersionError,
  QRunAlreadyTerminalError,
  QRunNotResumableError,
  type QActionPort,
  type QOrchestrator,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * What happens after a person approves (live test 2026-09-28 #4: "I
 * approve, and it stays approval needed").
 *
 * The approved action executes as the paused run's continuation: resume
 * the run, and its approval gate executes through the Approval Engine's
 * execution gate. A run that can no longer be resumed -- it ended while
 * the card waited (a turn aborted after the proposal was committed, a
 * redeploy, a failure) -- used to leave the action APPROVED forever, with
 * nothing to execute it. Now the same execution gate is called directly
 * for it. Nothing is widened: the gate re-reads the action, requires a
 * usable approval by this person, reauthorises them now, and claims the
 * action so a racing resume or a retry never executes twice.
 */
export type ApprovedContinuation = (input: {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly actionId: QActionProposalId;
  readonly correlationId: CorrelationId;
}) => Promise<void>;

export function createApprovedContinuation(dependencies: {
  /** Resolved at call time: composed after the routes and tools that call this. */
  readonly orchestrator: () => QOrchestrator | undefined;
  readonly actions: Pick<QActionPort, "executeApproved">;
  readonly logger?: Logger | undefined;
}): ApprovedContinuation {
  const { actions, logger } = dependencies;
  return async ({ actor, runId, actionId, correlationId }) => {
    const orchestrator = dependencies.orchestrator();
    if (orchestrator !== undefined) {
      try {
        const handle = await orchestrator.resume({
          actor,
          runId,
          correlationId,
        });
        if (handle.status !== "FAILED") return;
        // The resume ran and failed (live 2026-10-01, 6b04d028: the run
        // ended INTERNAL_ERROR and the approved action stayed APPROVED).
        // The approval stands, so the action goes through the gate on its
        // own; the gate's claim makes a second execution impossible.
        logger?.warn(
          { qRunId: runId, actionId, correlationId },
          "approved action's run failed on resume; executing through the gate",
        );
      } catch (error: unknown) {
        // A run the conversational engine never ran (a standing
        // instruction's card, ADR 0043) or a version this build cannot
        // continue: the gate executes it, re-verifying everything.
        if (
          !(error instanceof QRunNotResumableError) &&
          !(error instanceof QRunAlreadyTerminalError) &&
          !(error instanceof QOrchestrationVersionError)
        ) {
          throw error;
        }
        logger?.warn(
          { qRunId: runId, actionId, correlationId, reason: error.name },
          "approved action's run is not resumable; executing through the gate",
        );
      }
    }
    const outcome = await actions.executeApproved({
      actor,
      runId,
      tenantId: actor.tenantId,
      correlationId,
      actionId,
    });
    logger?.info(
      { qRunId: runId, actionId, correlationId, outcome: outcome.kind },
      "approved action executed without its run",
    );
  };
}
