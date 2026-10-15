import { randomUUID } from "node:crypto";

import {
  isTerminalQRunStatus,
  Q_RUN_STATUSES,
  QStreamEventSchema,
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
  /**
   * Successive moves in one transaction (CONTEXT_RESOLUTION, then
   * POLICY_CHECK): each status is still taken and recorded in order; the
   * optional stage goes with the last.
   */
  readonly advanceThrough: (
    ref: QRunRef,
    steps: readonly QRunStatus[],
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
    /** Q's own sentence for this failure (CQ-QX-005); see QPublicFailure.notice. */
    notice?: string,
  ) => Promise<QLifecycleOutcome>;
  /** CANCEL_REQUESTED → CANCELLED, with the terminal event. */
  readonly finishCancellation: (ref: QRunRef) => Promise<QLifecycleOutcome>;
  /**
   * A run paused for a person (AWAITING_APPROVAL / AWAITING_INPUT) whose
   * wait ran out → EXPIRED. Nothing failed: the person did not answer in
   * time, and the lifecycle says so rather than calling it a failure.
   */
  readonly expire: (
    ref: QRunRef,
    diagnosticCode: "APPROVAL_EXPIRED" | "RUN_EXPIRED",
  ) => Promise<QLifecycleOutcome>;
};

type Move = {
  readonly to: QRunStatus;
  readonly stage?: QVisibleStage | undefined;
  readonly startedAt?: string | undefined;
  readonly orchestrationVersion?: string | undefined;
  readonly modelPolicyVersion?: string | undefined;
  readonly promptBundleVersion?: string | undefined;
  readonly failureCode?: QFailureDiagnosticCode | undefined;
  readonly event?:
    | ((run: Pick<QRunRecord, "id" | "completedAt">) => QRunEventInput)
    | undefined;
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
    return moveThrough(ref, [request]);
  }

  /**
   * Several lifecycle moves in ONE transaction, each checked and recorded
   * exactly as a single move is (status, version, stage event, log line).
   * Speed sweep 2026-10-01: each move was its own locked transaction,
   * 65-147 ms apiece before the answer could start. Stops at the first
   * move that does not advance and returns that outcome.
   */
  async function moveThrough(
    ref: QRunRef,
    requests: readonly Move[],
  ): Promise<QLifecycleOutcome> {
    const chained = await moveChain(ref, requests);
    if (chained !== null) return chained;
    return transactions.run(async (tx: TransactionContext) => {
      const locked = await repositories.runs.lockForActor(
        tx,
        ref.tenantId,
        ref.actorUserId,
        ref.runId,
      );
      if (locked === null) {
        throw new QRunNotFoundError();
      }
      let outcome: QLifecycleOutcome = { kind: "UNCHANGED", run: locked };
      for (const request of requests) {
        outcome = await step(tx, outcome.run, request);
        if (outcome.kind !== "ADVANCED" && outcome.kind !== "UNCHANGED") {
          return outcome;
        }
      }
      return outcome;
    });
  }

  /**
   * S2: the ordinary case - a legal chain from a run that has not moved
   * yet - as one statement (see QRunMoveChain). Null whenever anything is
   * unusual (a replay, a terminal or cancel-requested run, an unlisted
   * chain, a move with both a stage and an event, no store support): the
   * locked step-by-step path then decides, with its outcomes unchanged.
   */
  async function moveChain(
    ref: QRunRef,
    requests: readonly Move[],
  ): Promise<QLifecycleOutcome | null> {
    const chain = repositories.runs.moveChain;
    const first = requests[0];
    const last = requests[requests.length - 1];
    if (chain === undefined || first === undefined || last === undefined) {
      return null;
    }
    for (let at = 1; at < requests.length; at += 1) {
      const from = requests[at - 1]?.to;
      const to = requests[at]?.to;
      if (from === undefined || to === undefined || !canTransition(from, to)) {
        return null;
      }
    }
    // Only the last move may carry a stage or an event, and not both.
    for (const request of requests.slice(0, -1)) {
      if (request.stage !== undefined || request.event !== undefined) {
        return null;
      }
    }
    if (last.stage !== undefined && last.event !== undefined) return null;
    // The same rules `step` applies one run at a time: already there is a
    // replay, a terminal run is left alone, and a pending cancellation is
    // only ever completed, never worked past.
    const allowedFrom = Q_RUN_STATUSES.filter(
      (status) =>
        status !== first.to &&
        !isTerminalQRunStatus(status) &&
        (status !== "CANCEL_REQUESTED" || first.to === "CANCELLED") &&
        canTransition(status, first.to),
    );
    if (allowedFrom.length === 0) return null;

    const completedAt = isTerminalQRunStatus(last.to)
      ? new Date().toISOString()
      : undefined;
    // The event is parsed against the stream contract before it is
    // written, as appendRunEvent does; the sequence is a stand-in.
    const input =
      last.stage !== undefined
        ? ({
            type: "q.stage.changed",
            data: { stage: last.stage },
          } as const)
        : last.event?.({ id: ref.runId, completedAt: completedAt ?? null });
    const event =
      input === undefined
        ? undefined
        : QStreamEventSchema.parse({
            contractVersion: 1,
            eventId: randomUUID(),
            runId: ref.runId,
            sequence: 1,
            occurredAt: new Date().toISOString(),
            type: input.type,
            data: input.data,
          });
    const moved = await chain(sql, {
      tenantId: ref.tenantId,
      actorUserId: ref.actorUserId,
      runId: ref.runId,
      allowedFrom,
      steps: requests.length,
      status: last.to,
      startedAt: requests.find((r) => r.startedAt !== undefined)?.startedAt,
      completedAt,
      failureCode: last.failureCode,
      orchestrationVersion: requests.find(
        (r) => r.orchestrationVersion !== undefined,
      )?.orchestrationVersion,
      modelPolicyVersion: last.modelPolicyVersion,
      promptBundleVersion: last.promptBundleVersion,
      ...(event === undefined
        ? {}
        : {
            event: {
              eventType: event.type,
              visibleStage:
                event.type === "q.stage.changed" ? event.data.stage : null,
              payload: event.data,
              onlyIfStageDiffers: last.stage !== undefined,
            },
          }),
    });
    if (moved === null) return null;
    for (const request of requests) {
      dependencies.logger?.info(
        {
          qRunId: moved.id,
          status: request.to,
          ...(request.stage === undefined ? {} : { stage: request.stage }),
          correlationId: moved.correlationId,
        },
        "q run advanced",
      );
    }
    return { kind: "ADVANCED", run: moved };
  }

  async function step(
    tx: TransactionContext,
    run: QRunRecord,
    request: Move,
  ): Promise<QLifecycleOutcome> {
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
    advanceThrough: (ref, steps, stage) =>
      moveThrough(
        ref,
        steps.map((to, index) => ({
          to,
          ...(index === steps.length - 1 && stage !== undefined
            ? { stage }
            : {}),
        })),
      ),
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
    fail: (ref, diagnosticCode, notice) =>
      move(ref, {
        to: "FAILED",
        failureCode: diagnosticCode,
        event: (run) => ({
          type: "q.run.failed",
          data: {
            status: "FAILED",
            failure: toPublicQFailure(
              { diagnosticCode },
              {
                runId: run.id,
                ...(notice === undefined ? {} : { notice }),
              },
            ),
          },
        }),
      }),
    expire: (ref, diagnosticCode) =>
      move(ref, {
        to: "EXPIRED",
        failureCode: diagnosticCode,
        event: (run) => ({
          type: "q.run.failed",
          data: {
            status: "EXPIRED",
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
