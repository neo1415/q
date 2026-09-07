import {
  isTerminalQRunStatus,
  toPublicQFailure,
  type CorrelationId,
  type QFailureDiagnosticCode,
  type QRunId,
  type QRunStatus,
  type QVisibleStage,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext, TenantId, UserId } from "@capital-q/security";

import type { QRunRecord } from "../contracts/index.js";
import {
  QRunNotFoundError,
  QRunTransitionError,
  QRunVersionConflictError,
} from "../domain/errors.js";
import { canTransition } from "../domain/lifecycle.js";
import { ownedRun } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";
import { appendRunEvent, type QRunEventInput } from "./run-events.js";

/**
 * The lifecycle surface an orchestration engine drives (doc 12 §9, §10.5).
 *
 * Every move is applied under the run's row lock and is idempotent: asking
 * for a status the run already holds is UNCHANGED, not an error, because a
 * resumed engine may replay a node and ask again. A stage event is
 * appended only when the stage actually changes, so replay cannot
 * duplicate one. The canonical status stays authoritative throughout —
 * an engine that finds CANCEL_REQUESTED at a boundary is told so and
 * stops; it never overrides it.
 *
 * Trusted callers only. The run reference carries the owner and tenant the
 * engine captured when the run was authorised through `loadOwnedRun`, and
 * every read and write here still carries both.
 */

export type QRunRef = {
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
};

export function runRef(run: QRunRecord): QRunRef {
  return {
    runId: run.id,
    tenantId: run.tenantId,
    actorUserId: run.actorUserId,
  };
}

export type QLifecycleOutcome = {
  readonly kind:
    /** The move was applied. */
    | "ADVANCED"
    /** The run was already there (replay). */
    | "UNCHANGED"
    /** Cancellation is pending; the engine must stop and finish it. */
    | "CANCEL_REQUESTED"
    /** The run already ended; nothing further may happen to it. */
    | "TERMINAL";
  readonly run: QRunRecord;
};

export type QOrchestrationRuntime = {
  /** Authorises the actor for the run (404-safe) before any engine state is read. */
  readonly loadOwnedRun: (
    actor: ActorContext,
    runId: QRunId,
    correlationId?: CorrelationId,
  ) => Promise<QRunRecord>;
  /** The run as its owner, or null. Owner- and tenant-scoped. */
  readonly readRun: (ref: QRunRef) => Promise<QRunRecord | null>;
  /**
   * RECEIVED → PREFLIGHT: records the real start time and the orchestration
   * version, and shows the person the first stage.
   */
  readonly begin: (
    ref: QRunRef,
    orchestrationVersion: string,
  ) => Promise<QLifecycleOutcome>;
  /** One lifecycle move, with an optional visible stage. */
  readonly advance: (
    ref: QRunRef,
    to: QRunStatus,
    stage?: QVisibleStage,
  ) => Promise<QLifecycleOutcome>;
  /** PLANNING → AWAITING_INPUT. The engine has interrupted; the person may resume. */
  readonly pause: (ref: QRunRef) => Promise<QLifecycleOutcome>;
  /** AWAITING_INPUT → PLANNING, before the engine is resumed. */
  readonly resumeFromPause: (ref: QRunRef) => Promise<QLifecycleOutcome>;
  /**
   * AWAITING_APPROVAL → ACTION_EXECUTION, before the engine is resumed to
   * execute an approved action (CQ-Q-008). The move is a lifecycle fact;
   * the approval itself is re-verified by the action port, never here.
   */
  readonly resumeFromApproval: (ref: QRunRef) => Promise<QLifecycleOutcome>;
  readonly complete: (
    ref: QRunRef,
    metadata?: {
      readonly modelPolicyVersion?: string | undefined;
      readonly promptBundleVersion?: string | undefined;
    },
  ) => Promise<QLifecycleOutcome>;
  readonly fail: (
    ref: QRunRef,
    diagnosticCode: QFailureDiagnosticCode,
  ) => Promise<QLifecycleOutcome>;
  /** CANCEL_REQUESTED → CANCELLED, with the terminal event. */
  readonly finishCancellation: (ref: QRunRef) => Promise<QLifecycleOutcome>;
};

type Move = {
  readonly to: QRunStatus;
  readonly stage?: QVisibleStage | undefined;
  readonly startedAt?: string | undefined;
  readonly orchestrationVersion?: string | undefined;
  readonly modelPolicyVersion?: string | undefined;
  readonly promptBundleVersion?: string | undefined;
  readonly failureCode?: QFailureDiagnosticCode | undefined;
  readonly event?: ((run: QRunRecord) => QRunEventInput) | undefined;
};

export function createQOrchestrationRuntime(
  dependencies: QRuntimeDependencies,
): QOrchestrationRuntime {
  const { transactions, repositories, sql } = dependencies;

  const readRun = (ref: QRunRef) =>
    repositories.runs.findForActor(
      sql,
      ref.tenantId,
      ref.actorUserId,
      ref.runId,
    );

  async function move(ref: QRunRef, request: Move): Promise<QLifecycleOutcome> {
    return transactions.run(async (tx: TransactionContext) => {
      const run = await repositories.runs.lockForActor(
        tx,
        ref.tenantId,
        ref.actorUserId,
        ref.runId,
      );
      if (run === null) {
        throw new QRunNotFoundError();
      }
      if (run.status === request.to) {
        return { kind: "UNCHANGED", run };
      }
      if (isTerminalQRunStatus(run.status)) {
        return { kind: "TERMINAL", run };
      }
      // A pending cancellation is only ever completed, never worked past.
      if (run.status === "CANCEL_REQUESTED" && request.to !== "CANCELLED") {
        return { kind: "CANCEL_REQUESTED", run };
      }
      if (!canTransition(run.status, request.to)) {
        throw new QRunTransitionError(run.status, request.to);
      }

      const moved = await repositories.runs.transition(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        expectedVersion: run.version,
        status: request.to,
        startedAt: request.startedAt,
        completedAt: isTerminalQRunStatus(request.to)
          ? new Date().toISOString()
          : undefined,
        failureCode: request.failureCode,
        orchestrationVersion: request.orchestrationVersion,
        modelPolicyVersion: request.modelPolicyVersion,
        promptBundleVersion: request.promptBundleVersion,
      });
      if (moved === null) {
        throw new QRunVersionConflictError();
      }

      if (request.stage !== undefined) {
        const current = await repositories.runEvents.latestVisibleStage(
          tx.sql,
          moved.tenantId,
          moved.id,
        );
        if (current !== request.stage) {
          await appendRunEvent(repositories, tx, moved, {
            type: "q.stage.changed",
            data: { stage: request.stage },
          });
        }
      }
      if (request.event !== undefined) {
        await appendRunEvent(repositories, tx, moved, request.event(moved));
      }

      dependencies.logger?.info(
        {
          qRunId: moved.id,
          status: moved.status,
          ...(request.stage === undefined ? {} : { stage: request.stage }),
          correlationId: moved.correlationId,
        },
        "q run advanced",
      );
      return { kind: "ADVANCED", run: moved };
    });
  }

  return {
    loadOwnedRun: (actor, runId, correlationId) =>
      ownedRun(dependencies, sql, actor, runId, correlationId),
    readRun,
    begin: (ref, orchestrationVersion) =>
      move(ref, {
        to: "PREFLIGHT",
        stage: "UNDERSTANDING_REQUEST",
        startedAt: new Date().toISOString(),
        orchestrationVersion,
      }),
    advance: (ref, to, stage) => move(ref, { to, stage }),
    pause: (ref) => move(ref, { to: "AWAITING_INPUT" }),
    resumeFromPause: (ref) => move(ref, { to: "PLANNING" }),
    resumeFromApproval: (ref) =>
      move(ref, {
        to: "ACTION_EXECUTION",
        stage: "COMPLETING_APPROVED_ACTION",
      }),
    complete: (ref, metadata = {}) =>
      move(ref, {
        to: "COMPLETED",
        modelPolicyVersion: metadata.modelPolicyVersion,
        promptBundleVersion: metadata.promptBundleVersion,
        event: (run) => ({
          type: "q.run.completed",
          data: {
            status: "COMPLETED",
            completedAt: run.completedAt ?? new Date().toISOString(),
          },
        }),
      }),
    fail: (ref, diagnosticCode) =>
      move(ref, {
        to: "FAILED",
        failureCode: diagnosticCode,
        event: (run) => ({
          type: "q.run.failed",
          data: {
            status: "FAILED",
            failure: toPublicQFailure({ diagnosticCode }, { runId: run.id }),
          },
        }),
      }),
    finishCancellation: (ref) =>
      move(ref, {
        to: "CANCELLED",
        failureCode: "RUN_CANCELLED",
        event: (run) => ({
          type: "q.run.failed",
          data: {
            status: "CANCELLED",
            failure: toPublicQFailure(
              { diagnosticCode: "RUN_CANCELLED" },
              { runId: run.id },
            ),
          },
        }),
      }),
  };
}
