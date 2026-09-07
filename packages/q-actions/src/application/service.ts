import { randomUUID } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  SecurityEventTypeSchema,
  type MaterialActionAuditWriter,
  type SecurityEventWriter,
} from "@capital-q/audit";
import {
  Q_CONTRACT_VERSION,
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QApprovalViewSchema,
  type CorrelationId,
  type QActionProposalId,
  type QActionStatus,
  type QApprovalId,
  type QApprovalStatus,
  type QApprovalView,
  type QRunId,
  type QSubjectRef,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import { getMeter, getTracer, type Logger } from "@capital-q/observability";
import {
  appendRunEvent,
  canTransition,
  type QActionExecuteContext,
  type QActionExecuteOutcome,
  type QRunRecord,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import type { AnyQActionDefinition, ApprovedQAction } from "../definition.js";
import {
  bindingEnvelope,
  hashBindingEnvelope,
  hashesMatch,
} from "../domain/binding.js";
import {
  QActionAlreadyCompletedError,
  QActionNotFoundError,
  QActionNotPermittedError,
  QActionPayloadMismatchError,
  QActionUnavailableError,
  QActionVersionConflictError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  QApprovalNotFoundError,
  QApprovalNotPermittedError,
} from "../domain/errors.js";
import {
  approvalIsOpen,
  approvalIsUsable,
  assertActionTransition,
  assertApprovalTransition,
} from "../domain/lifecycle.js";
import {
  QActionApprovedEvent,
  QActionExecutedEvent,
  QActionExecutionFailedEvent,
  QActionPreparedEvent,
  QActionRejectedEvent,
  qActionEvent,
  type QActionEventContext,
} from "../events/index.js";
import {
  DEFAULT_Q_APPROVAL_POLICY,
  systemQActionClock,
  type QActionClock,
  type QActionRecord,
  type QActionRepositories,
  type QApprovalPolicy,
  type QApprovalRecord,
} from "../ports.js";
import type { QActionRegistry } from "../registry.js";

/**
 * The Approval Engine (doc 12 §29-§32; doc 15 §50-§53; CQ-Q-008).
 *
 *   Q proposes → deterministic checks → exact proposal persisted + hashed
 *   → approval requested (one transaction, run paused)
 *   → a person approves or declines (server-derived identity, capability,
 *     resource authority, expiry, hash — one transaction)
 *   → execution: reauthorize, re-verify approval and hash, claim
 *     atomically, run the registered executor once, record the outcome
 *
 * Nothing here trusts a model, a tool result, a browser field, a graph
 * checkpoint or a spoken word. Authority is the persisted approval row
 * plus the live authorization decision, and success is the persisted
 * execution status. Every message a person may read is plain English on
 * the domain error; every code that is logged or metered is stable.
 */

export type QActionServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repositories: QActionRepositories;
  /** The run and run-event repositories the proposal and decision transactions move. */
  readonly runtime: Pick<QRuntimeRepositories, "runs" | "runEvents">;
  readonly registry: QActionRegistry;
  readonly authorization: AuthorizationService;
  readonly audit: MaterialActionAuditWriter;
  readonly securityEvents?: SecurityEventWriter | undefined;
  readonly outbox?: OutboxWriter | undefined;
  readonly clock?: QActionClock | undefined;
  readonly policy?: QApprovalPolicy | undefined;
  readonly logger?: Logger | undefined;
};

export type ProposeQActionCommand = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  readonly actionType: string;
  /** Untrusted: validated by the registered definition's schema. */
  readonly payload: unknown;
};

export type ProposeQActionResult = {
  readonly action: QActionRecord;
  readonly approval: QApprovalRecord;
};

export type QApprovalQuery = {
  readonly actor: ActorContext;
  readonly approvalId: QApprovalId;
  readonly correlationId?: CorrelationId | undefined;
};

export type DecideQApprovalCommand = {
  readonly actor: ActorContext;
  readonly approvalId: QApprovalId;
  readonly correlationId: CorrelationId;
  readonly reason?: string | undefined;
};

export type DecideQApprovalResult = {
  readonly view: QApprovalView;
  /** False when the same person had already made this exact decision (a retried request). */
  readonly decided: boolean;
  readonly action: QActionRecord;
  readonly approval: QApprovalRecord;
};

export type QActionService = {
  readonly propose: (
    command: ProposeQActionCommand,
  ) => Promise<ProposeQActionResult>;
  readonly getApproval: (query: QApprovalQuery) => Promise<QApprovalView>;
  readonly approve: (
    command: DecideQApprovalCommand,
  ) => Promise<DecideQApprovalResult>;
  readonly reject: (
    command: DecideQApprovalCommand,
  ) => Promise<DecideQApprovalResult>;
  /** The idempotent execution gate (CQ-Q-008 §52, §110). */
  readonly executeApproved: (
    context: QActionExecuteContext,
  ) => Promise<QActionExecuteOutcome>;
  /** The approval as the run's owner may read it, for orchestration and tests. */
  readonly findApprovalForAction: (
    tenantId: ActorContext["tenantId"],
    actionId: QActionProposalId,
  ) => Promise<QApprovalRecord | null>;
};

const Q_ACTION_APPROVE = capability("q.action.approve");
const RESOURCE_Q_ACTION = AuditResourceTypeSchema.parse("q_action");
const RESOURCE_Q_APPROVAL = AuditResourceTypeSchema.parse("q_approval");
const SECURITY_PERMISSION_DENIED =
  SecurityEventTypeSchema.parse("permission_denied");
const SECURITY_HASH_MISMATCH = SecurityEventTypeSchema.parse(
  "q_action_payload_mismatch",
);
const SECURITY_EXECUTION_BLOCKED = SecurityEventTypeSchema.parse(
  "q_action_execution_blocked",
);

const AUDIT = {
  proposed: AuditActionTypeSchema.parse("q.action.proposed"),
  approved: AuditActionTypeSchema.parse("q.action.approved"),
  rejected: AuditActionTypeSchema.parse("q.action.rejected"),
  executed: AuditActionTypeSchema.parse("q.action.executed"),
  executionFailed: AuditActionTypeSchema.parse("q.action.execution_failed"),
  executionBlocked: AuditActionTypeSchema.parse("q.action.execution_blocked"),
} as const;

function iso(date: Date): UtcTimestamp {
  return date.toISOString();
}

export function idempotencyKeyFor(
  runId: QRunId,
  actionId: QActionProposalId,
): string {
  return `q_action:${runId}:${actionId}`;
}

/** The binding envelope of a persisted action; the only input to any hash the engine compares. */
export function envelopeOf(action: QActionRecord) {
  return bindingEnvelope({
    bindingVersion: 1,
    tenantId: action.tenantId,
    organisationId: action.organisationId,
    runId: action.runId,
    actionId: action.id,
    actionType: action.actionType,
    actionVersion: action.actionVersion,
    actionClass: action.riskClass,
    targets: [...action.targets],
    payload: action.payload,
  });
}

export function projectedApprovalStatus(
  approval: QApprovalRecord,
  now: Date,
): QApprovalStatus {
  return approval.status === "PENDING" && !approvalIsOpen(approval, now)
    ? "EXPIRED"
    : approval.status;
}

function projectedActionStatus(
  action: QActionRecord,
  approval: QApprovalRecord,
  now: Date,
): QActionStatus {
  const lapsed =
    (approval.status === "PENDING" && !approvalIsOpen(approval, now)) ||
    (approval.status === "APPROVED" &&
      !approvalIsUsable(approval, now) &&
      action.status === "APPROVED");
  return lapsed &&
    (action.status === "AWAITING_APPROVAL" || action.status === "APPROVED")
    ? "EXPIRED"
    : action.status;
}

/** The public projection (CQ-Q-008 §41, §84): parsed into the allowlist, never serialised from rows. */
export function toApprovalView(
  approval: QApprovalRecord,
  action: QActionRecord,
  now: Date,
): QApprovalView {
  const decidedAt =
    approval.approvedAt ??
    approval.rejectedAt ??
    approval.revokedAt ??
    undefined;
  return QApprovalViewSchema.parse({
    contractVersion: Q_CONTRACT_VERSION,
    approvalId: approval.id,
    runId: action.runId,
    status: projectedApprovalStatus(approval, now),
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    canDecide: approvalIsOpen(approval, now),
    action: {
      actionId: action.id,
      actionType: action.actionType,
      actionVersion: action.actionVersion,
      actionClass: action.riskClass,
      actionStatus: projectedActionStatus(action, approval, now),
      targets: [...action.targets],
      summary: action.summary,
      ...(action.preview === null ? {} : { preview: action.preview }),
      ...(action.executedAt === null ? {} : { executedAt: action.executedAt }),
    },
  });
}

export function createQActionService(
  dependencies: QActionServiceDependencies,
): QActionService {
  const {
    sql,
    transactions,
    repositories,
    runtime,
    registry,
    authorization,
    audit,
    logger,
  } = dependencies;
  const clock = dependencies.clock ?? systemQActionClock;
  const policy = dependencies.policy ?? DEFAULT_Q_APPROVAL_POLICY;
  const tracer = getTracer("@capital-q/q-actions");
  const meter = getMeter("@capital-q/q-actions");
  const metrics = {
    proposals: meter.createCounter("q.action.proposals"),
    approvalsRequested: meter.createCounter("q.action.approvals_requested"),
    approvalsAccepted: meter.createCounter("q.action.approvals_accepted"),
    approvalsRejected: meter.createCounter("q.action.approvals_rejected"),
    approvalsExpired: meter.createCounter("q.action.approvals_expired"),
    hashMismatchBlocks: meter.createCounter("q.action.hash_mismatch_blocks"),
    reauthorizationBlocks: meter.createCounter(
      "q.action.reauthorization_blocks",
    ),
    duplicateExecutionPrevented: meter.createCounter(
      "q.action.duplicate_execution_prevented",
    ),
    executions: meter.createCounter("q.action.executions"),
  };

  async function securityEvent(input: {
    readonly type: ReturnType<typeof SecurityEventTypeSchema.parse>;
    readonly severity: "MEDIUM" | "HIGH";
    readonly actor: ActorContext;
    readonly resourceType: typeof RESOURCE_Q_ACTION;
    readonly resourceId: string;
    readonly reason: string;
    readonly correlationId?: CorrelationId | undefined;
  }): Promise<void> {
    if (dependencies.securityEvents === undefined) {
      return;
    }
    try {
      await dependencies.securityEvents.record({
        auditEventId: createAuditEventId(),
        tenantId: input.actor.tenantId,
        userId: input.actor.userId,
        eventType: input.type,
        severity: input.severity,
        resourceType: input.resourceType,
        resourceId: AuditResourceIdSchema.parse(input.resourceId),
        occurredAt: occurredNow(),
        metadata: { reason: input.reason },
        ...(input.correlationId === undefined
          ? {}
          : { correlationId: input.correlationId }),
      });
    } catch (error: unknown) {
      // A failed record never turns a refusal into an allow.
      logger?.warn(
        { err: error, resourceType: input.resourceType },
        "security event not recorded",
      );
    }
  }

  function eventContext(
    action: QActionRecord,
    actor: { readonly type: "HUMAN" | "Q"; readonly id: string },
    correlationId: CorrelationId,
  ): QActionEventContext {
    return {
      tenantId: action.tenantId,
      organisationId: action.organisationId,
      actor,
      correlationId,
      actionId: action.id,
      actionVersion: action.version,
    };
  }

  function eventData(action: QActionRecord, approvalId: QApprovalId) {
    return {
      actionId: action.id,
      runId: action.runId,
      actionType: action.actionType,
      actionVersion: action.actionVersion,
      riskClass: action.riskClass,
      actionStatus: action.status,
      approvalId,
    };
  }

  /** Bounded, reference-only audit metadata. Never the payload, never a preview. */
  function auditMetadata(
    action: QActionRecord,
    extra: Record<string, string | number | boolean | null> = {},
  ) {
    return {
      runId: action.runId,
      actionId: action.id,
      actionType: action.actionType,
      actionVersion: action.actionVersion,
      riskClass: action.riskClass,
      payloadHash: action.payloadHash,
      targetCount: action.targets.length,
      ...extra,
    };
  }

  /**
   * One lifecycle move of the run inside the caller's transaction, under
   * the same rules the orchestration runtime applies. Duplicated here on
   * purpose: the proposal and the decision must move the run in the same
   * transaction as the action and the approval (CQ-Q-008 §108-§109), and
   * the runtime's own helper opens its own.
   */
  async function moveRun(
    tx: TransactionContext,
    run: QRunRecord,
    to: QRunRecord["status"],
    options: {
      readonly stage?: "WAITING_FOR_APPROVAL" | undefined;
      readonly events?:
        readonly Parameters<typeof appendRunEvent>[3][] | undefined;
      readonly complete?: boolean | undefined;
    } = {},
  ): Promise<QRunRecord> {
    if (!canTransition(run.status, to)) {
      throw new QActionVersionConflictError();
    }
    const moved = await runtime.runs.transition(tx, {
      tenantId: run.tenantId,
      runId: run.id,
      expectedVersion: run.version,
      status: to,
      completedAt: options.complete === true ? iso(clock.now()) : undefined,
    });
    if (moved === null) {
      throw new QActionVersionConflictError();
    }
    if (options.stage !== undefined) {
      const current = await runtime.runEvents.latestVisibleStage(
        tx.sql,
        moved.tenantId,
        moved.id,
      );
      if (current !== options.stage) {
        await appendRunEvent(runtime, tx, moved, {
          type: "q.stage.changed",
          data: { stage: options.stage },
        });
      }
    }
    for (const event of options.events ?? []) {
      await appendRunEvent(runtime, tx, moved, event);
    }
    return moved;
  }

  /**
   * Loads the approval and its action for a person, or refuses with the one
   * enumeration-safe answer. Only the person the decision was requested
   * from, in the organisation context the action was taken for, in the
   * tenant that holds it, may see or decide it; a colleague, another
   * organisation context or another tenant learns only "not found".
   */
  async function loadForActor(
    executor: DatabaseExecutor,
    actor: ActorContext,
    approvalId: QApprovalId,
    correlationId: CorrelationId | undefined,
    lock: TransactionContext | null,
  ): Promise<{ approval: QApprovalRecord; action: QActionRecord }> {
    const approval =
      lock === null
        ? await repositories.approvals.findById(
            executor,
            actor.tenantId,
            approvalId,
          )
        : await repositories.approvals.lockById(
            lock,
            actor.tenantId,
            approvalId,
          );
    if (approval === null) {
      const ownership = await repositories.approvals.findOwnership(
        executor,
        approvalId,
      );
      if (ownership !== null) {
        await securityEvent({
          type: SECURITY_PERMISSION_DENIED,
          severity: "MEDIUM",
          actor,
          resourceType: RESOURCE_Q_APPROVAL,
          resourceId: approvalId,
          reason: "foreign_tenant",
          correlationId,
        });
      }
      throw new QApprovalNotFoundError();
    }
    const action =
      lock === null
        ? await repositories.actions.findById(
            executor,
            actor.tenantId,
            approval.actionId,
          )
        : await repositories.actions.lockById(
            lock,
            actor.tenantId,
            approval.actionId,
          );
    if (action === null) {
      throw new QApprovalNotFoundError();
    }
    if (
      approval.requestedFromUserId !== actor.userId ||
      action.organisationId !== (actor.organisationId ?? null) ||
      actor.actorType !== "HUMAN"
    ) {
      await securityEvent({
        type: SECURITY_PERMISSION_DENIED,
        severity: "MEDIUM",
        actor,
        resourceType: RESOURCE_Q_APPROVAL,
        resourceId: approvalId,
        reason:
          actor.actorType !== "HUMAN"
            ? "non_human_actor"
            : approval.requestedFromUserId !== actor.userId
              ? "not_requested_approver"
              : "wrong_organisation_context",
        correlationId,
      });
      throw new QApprovalNotFoundError();
    }
    return { approval, action };
  }

  /** The live authority an approver must hold now: the approve capability and the action's own permission. */
  async function approverAuthority(
    actor: ActorContext,
    action: QActionRecord,
    definition: AnyQActionDefinition,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (action.organisationId === null || actor.organisationId === undefined) {
      return { ok: false, reason: "organisation_context_required" };
    }
    const decision = await authorization.authorize({
      actor,
      capability: Q_ACTION_APPROVE,
      resource: {
        kind: "ORGANISATION",
        tenantId: action.tenantId,
        organisationId: action.organisationId,
      },
    });
    if (decision.outcome !== "ALLOW") {
      return { ok: false, reason: "approve_capability_missing" };
    }
    const parsed = definition.payload.safeParse(action.payload);
    if (!parsed.success) {
      return { ok: false, reason: "payload_no_longer_valid" };
    }
    const own = await definition.authorize(parsed.data, actor);
    if (own.outcome !== "ALLOW") {
      return { ok: false, reason: `action_permission_missing:${own.code}` };
    }
    return { ok: true };
  }

  /** Marks a lapsed pending approval and its action EXPIRED, inside the caller's transaction. */
  async function expire(
    tx: TransactionContext,
    approval: QApprovalRecord,
    action: QActionRecord,
  ): Promise<void> {
    assertApprovalTransition(approval.status, "EXPIRED");
    const decided = await repositories.approvals.decide(tx, {
      tenantId: approval.tenantId,
      approvalId: approval.id,
      expectedVersion: approval.version,
      status: "EXPIRED",
    });
    if (decided === null) {
      throw new QActionVersionConflictError();
    }
    if (action.status === "AWAITING_APPROVAL" || action.status === "APPROVED") {
      assertActionTransition(action.status, "EXPIRED");
      const moved = await repositories.actions.transition(tx, {
        tenantId: action.tenantId,
        actionId: action.id,
        expectedVersion: action.version,
        status: "EXPIRED",
      });
      if (moved === null) {
        throw new QActionVersionConflictError();
      }
    }
    metrics.approvalsExpired.add(1, { action_type: action.actionType });
  }

  /** The run left AWAITING_APPROVAL (cancelled, expired): the open request is void. */
  async function revokeForRun(
    tx: TransactionContext,
    approval: QApprovalRecord,
    action: QActionRecord,
  ): Promise<void> {
    assertApprovalTransition(approval.status, "REVOKED");
    await repositories.approvals.decide(tx, {
      tenantId: approval.tenantId,
      approvalId: approval.id,
      expectedVersion: approval.version,
      status: "REVOKED",
      revokedAt: iso(clock.now()),
      revokedByUserId: null,
    });
    if (action.status === "AWAITING_APPROVAL") {
      await repositories.actions.transition(tx, {
        tenantId: action.tenantId,
        actionId: action.id,
        expectedVersion: action.version,
        status: "WITHDRAWN",
      });
    }
  }

  const propose: QActionService["propose"] = async (command) => {
    const { actor, correlationId } = command;
    const definition = registry.get(command.actionType);
    if (definition === undefined) {
      // Unknown, unregistered or refused classes: no executor, no path.
      throw new QActionUnavailableError();
    }
    if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
      throw new QActionNotPermittedError();
    }
    const payload = definition.payload.safeParse(command.payload);
    if (!payload.success) {
      throw new QActionNotPermittedError();
    }
    const targets: readonly QSubjectRef[] = definition.targets(payload.data);
    if (targets.length === 0) {
      throw new QActionNotPermittedError();
    }
    // The person's authority to take THIS action, now. Approval later never
    // creates what is missing here.
    const authorized = await definition.authorize(payload.data, actor);
    if (authorized.outcome !== "ALLOW") {
      await securityEvent({
        type: SECURITY_PERMISSION_DENIED,
        severity: "MEDIUM",
        actor,
        resourceType: RESOURCE_Q_ACTION,
        resourceId: command.runId,
        reason: `proposal_not_authorized:${authorized.code}`,
        correlationId,
      });
      throw new QActionNotPermittedError();
    }
    const described = definition.describe(payload.data, targets);
    const now = clock.now();
    const actionId = QActionProposalIdSchema.parse(randomUUID());
    const approvalId = QApprovalIdSchema.parse(randomUUID());
    const expiresAt = iso(new Date(now.getTime() + policy.approvalTtlMs));

    return tracer.startActiveSpan(
      "q.action.propose",
      {
        attributes: {
          "q.run_id": command.runId,
          "q.action.id": actionId,
          "q.action.type": definition.actionType,
          "q.action.risk_class": definition.riskClass,
        },
      },
      async (span) => {
        try {
          return await transactions.run(async (tx) => {
            const run = await runtime.runs.lockForActor(
              tx,
              actor.tenantId,
              actor.userId,
              command.runId,
            );
            if (run === null) {
              throw new QActionNotFoundError();
            }
            if (run.actorOrganisationId !== (actor.organisationId ?? null)) {
              throw new QActionNotPermittedError();
            }
            if (!canTransition(run.status, "AWAITING_APPROVAL")) {
              throw new QActionVersionConflictError();
            }
            const payloadRecord = payload.data as Record<string, unknown>;
            const envelope = bindingEnvelope({
              bindingVersion: 1,
              tenantId: actor.tenantId,
              organisationId: actor.organisationId ?? null,
              runId: run.id,
              actionId,
              actionType: definition.actionType,
              actionVersion: definition.version,
              actionClass: definition.riskClass,
              targets: [...targets],
              payload: payloadRecord,
            });
            const payloadHash = hashBindingEnvelope(envelope);
            const inserted = await repositories.actions.insert(tx, {
              id: actionId,
              tenantId: actor.tenantId,
              runId: run.id,
              organisationId: actor.organisationId ?? null,
              proposedByUserId: actor.userId,
              actionType: definition.actionType,
              actionVersion: definition.version,
              riskClass: definition.riskClass,
              targets,
              payload: payloadRecord,
              payloadHash,
              summary: described.summary,
              preview: described.preview ?? null,
              idempotencyKey: idempotencyKeyFor(run.id, actionId),
            });
            assertActionTransition(inserted.status, "AWAITING_APPROVAL");
            const action = await repositories.actions.transition(tx, {
              tenantId: actor.tenantId,
              actionId,
              expectedVersion: inserted.version,
              status: "AWAITING_APPROVAL",
            });
            if (action === null) {
              throw new QActionVersionConflictError();
            }
            const approval = await repositories.approvals.insert(tx, {
              id: approvalId,
              tenantId: actor.tenantId,
              actionId,
              requestedFromUserId: actor.userId,
              requestedAt: iso(now),
              expiresAt,
            });

            await moveRun(tx, run, "AWAITING_APPROVAL", {
              stage: "WAITING_FOR_APPROVAL",
              events: [
                {
                  type: "q.action.proposed",
                  data: {
                    proposal: {
                      contractVersion: Q_CONTRACT_VERSION,
                      proposalId: actionId,
                      runId: run.id,
                      actionType: definition.actionType,
                      actionClass: definition.riskClass,
                      targets: [...targets],
                      summary: described.summary,
                      ...(described.preview === undefined
                        ? {}
                        : { preview: described.preview }),
                      approval: {
                        required: true,
                        approval: { approvalId, status: "PENDING" },
                      },
                      status: "PROPOSED",
                      createdAt: action.createdAt,
                      expiresAt,
                    },
                  },
                },
                {
                  type: "q.approval.required",
                  data: { proposalId: actionId, approvalId, expiresAt },
                },
              ],
            });

            await audit.record(tx, {
              auditEventId: createAuditEventId(),
              tenantId: actor.tenantId,
              actorType: "Q",
              actorId: run.id,
              authorityUserId: actor.userId,
              organisationId: actor.organisationId,
              actionType: AUDIT.proposed,
              resourceType: RESOURCE_Q_ACTION,
              resourceId: actionId,
              occurredAt: iso(now),
              outcome: "SUCCEEDED",
              metadata: auditMetadata(action, { approvalId, expiresAt }),
              correlationId,
            });
            if (dependencies.outbox !== undefined) {
              await dependencies.outbox.enqueue(
                tx,
                qActionEvent(
                  QActionPreparedEvent,
                  eventContext(
                    action,
                    { type: "Q", id: run.id },
                    correlationId,
                  ),
                  eventData(action, approvalId),
                ),
              );
            }
            metrics.proposals.add(1, { action_type: definition.actionType });
            metrics.approvalsRequested.add(1, {
              action_type: definition.actionType,
            });
            logger?.info(
              {
                qRunId: run.id,
                actionId,
                approvalId,
                actionType: definition.actionType,
                actionVersion: definition.version,
                riskClass: definition.riskClass,
                expiresAt,
                correlationId,
              },
              "q action proposed; approval requested",
            );
            return { action, approval };
          });
        } finally {
          span.end();
        }
      },
    );
  };

  const getApproval: QActionService["getApproval"] = async (query) => {
    const { approval, action } = await loadForActor(
      sql,
      query.actor,
      query.approvalId,
      query.correlationId,
      null,
    );
    return toApprovalView(approval, action, clock.now());
  };

  type Decision = "APPROVED" | "REJECTED";

  async function decide(
    command: DecideQApprovalCommand,
    decision: Decision,
  ): Promise<DecideQApprovalResult> {
    const { actor, correlationId } = command;
    return tracer.startActiveSpan(
      decision === "APPROVED" ? "q.action.approve" : "q.action.reject",
      { attributes: { "q.approval.id": command.approvalId } },
      async (span) => {
        let outcome = "unknown";
        try {
          // A lapsed request is a fact worth keeping: the EXPIRED rows commit
          // in this transaction and the refusal is raised after it, so the
          // person's next attempt meets "already decided", not a second sweep.
          const result = await transactions.run<
            DecideQApprovalResult | { readonly lapsed: true }
          >(async (tx) => {
            const { approval, action } = await loadForActor(
              tx.sql,
              actor,
              command.approvalId,
              correlationId,
              tx,
            );
            const now = clock.now();

            // A retried request for a decision this person already made is
            // the same decision, not a conflict.
            if (
              approval.status === decision &&
              ((decision === "APPROVED" &&
                approval.approvedByUserId === actor.userId) ||
                (decision === "REJECTED" &&
                  approval.rejectedByUserId === actor.userId))
            ) {
              outcome = "already_decided_same";
              return {
                view: toApprovalView(approval, action, now),
                decided: false,
                action,
                approval,
              };
            }
            if (approval.status !== "PENDING") {
              outcome = "already_decided";
              throw new QApprovalAlreadyDecidedError(approval.status);
            }
            if (!approvalIsOpen(approval, now)) {
              await expire(tx, approval, action);
              outcome = "expired";
              return { lapsed: true };
            }

            // The run must still be waiting for this decision. If it was
            // cancelled or timed out meanwhile, the open request is void.
            const run = await runtime.runs.lockForActor(
              tx,
              actor.tenantId,
              action.proposedByUserId,
              action.runId,
            );
            if (run === null) {
              throw new QApprovalNotFoundError();
            }
            if (run.status !== "AWAITING_APPROVAL") {
              await revokeForRun(tx, approval, action);
              outcome = "run_not_waiting";
              throw new QApprovalAlreadyDecidedError("REVOKED");
            }

            const definition = registry.get(action.actionType);
            if (
              definition === undefined ||
              definition.version !== action.actionVersion
            ) {
              // The action's definition is gone or changed: nothing may
              // execute it, so nothing may approve it.
              outcome = "definition_unavailable";
              throw new QActionUnavailableError();
            }

            if (decision === "APPROVED") {
              const authority = await approverAuthority(
                actor,
                action,
                definition,
              );
              if (!authority.ok) {
                await securityEvent({
                  type: SECURITY_PERMISSION_DENIED,
                  severity: "MEDIUM",
                  actor,
                  resourceType: RESOURCE_Q_APPROVAL,
                  resourceId: approval.id,
                  reason: authority.reason,
                  correlationId,
                });
                await audit.record(tx, {
                  auditEventId: createAuditEventId(),
                  ...humanActor(actor),
                  actionType: AUDIT.approved,
                  resourceType: RESOURCE_Q_ACTION,
                  resourceId: action.id,
                  occurredAt: iso(now),
                  outcome: "DENIED",
                  metadata: auditMetadata(action, {
                    approvalId: approval.id,
                    reason: authority.reason,
                  }),
                  correlationId,
                });
                outcome = "not_permitted";
                throw new QApprovalNotPermittedError();
              }
              // The fingerprint the person approves is recomputed from the
              // persisted proposal, never taken from a request.
              const recomputed = hashBindingEnvelope(envelopeOf(action));
              if (!hashesMatch(recomputed, action.payloadHash)) {
                metrics.hashMismatchBlocks.add(1, { stage: "approve" });
                await securityEvent({
                  type: SECURITY_HASH_MISMATCH,
                  severity: "HIGH",
                  actor,
                  resourceType: RESOURCE_Q_ACTION,
                  resourceId: action.id,
                  reason: "proposal_hash_mismatch_at_approval",
                  correlationId,
                });
                outcome = "hash_mismatch";
                throw new QActionPayloadMismatchError();
              }
              if (action.status !== "AWAITING_APPROVAL") {
                outcome = "action_not_awaiting";
                throw new QApprovalAlreadyDecidedError(approval.status);
              }
              assertApprovalTransition(approval.status, "APPROVED");
              assertActionTransition(action.status, "APPROVED");
              const decided = await repositories.approvals.decide(tx, {
                tenantId: approval.tenantId,
                approvalId: approval.id,
                expectedVersion: approval.version,
                status: "APPROVED",
                approvedAt: iso(now),
                approvedByUserId: actor.userId,
                approvalPayloadHash: recomputed,
              });
              const moved = await repositories.actions.transition(tx, {
                tenantId: action.tenantId,
                actionId: action.id,
                expectedVersion: action.version,
                status: "APPROVED",
              });
              if (decided === null || moved === null) {
                throw new QActionVersionConflictError();
              }
              await audit.record(tx, {
                auditEventId: createAuditEventId(),
                ...humanActor(actor),
                actionType: AUDIT.approved,
                resourceType: RESOURCE_Q_ACTION,
                resourceId: action.id,
                occurredAt: iso(now),
                outcome: "SUCCEEDED",
                metadata: auditMetadata(moved, {
                  approvalId: approval.id,
                  approvalPayloadHash: recomputed,
                }),
                correlationId,
              });
              if (dependencies.outbox !== undefined) {
                await dependencies.outbox.enqueue(
                  tx,
                  qActionEvent(
                    QActionApprovedEvent,
                    eventContext(
                      moved,
                      { type: "HUMAN", id: actor.userId },
                      correlationId,
                    ),
                    eventData(moved, approval.id),
                  ),
                );
              }
              metrics.approvalsAccepted.add(1, {
                action_type: action.actionType,
              });
              outcome = "approved";
              return {
                view: toApprovalView(decided, moved, now),
                decided: true,
                action: moved,
                approval: decided,
              };
            }

            // REJECTED: no capability is needed to decline one's own request.
            assertApprovalTransition(approval.status, "REJECTED");
            assertActionTransition(action.status, "REJECTED");
            const decided = await repositories.approvals.decide(tx, {
              tenantId: approval.tenantId,
              approvalId: approval.id,
              expectedVersion: approval.version,
              status: "REJECTED",
              rejectedAt: iso(now),
              rejectedByUserId: actor.userId,
              rejectionReason: command.reason ?? null,
            });
            const moved = await repositories.actions.transition(tx, {
              tenantId: action.tenantId,
              actionId: action.id,
              expectedVersion: action.version,
              status: "REJECTED",
            });
            if (decided === null || moved === null) {
              throw new QActionVersionConflictError();
            }
            // The run ends: nothing executes, the person was told, the
            // suspended engine is never resumed for it (CQ-Q-008 §48).
            await moveRun(tx, run, "COMPLETED", {
              complete: true,
              events: [
                {
                  type: "q.run.completed",
                  data: { status: "COMPLETED", completedAt: iso(now) },
                },
              ],
            });
            await audit.record(tx, {
              auditEventId: createAuditEventId(),
              ...humanActor(actor),
              actionType: AUDIT.rejected,
              resourceType: RESOURCE_Q_ACTION,
              resourceId: action.id,
              occurredAt: iso(now),
              outcome: "SUCCEEDED",
              metadata: auditMetadata(moved, {
                approvalId: approval.id,
                reasonGiven: command.reason !== undefined,
              }),
              correlationId,
            });
            if (dependencies.outbox !== undefined) {
              await dependencies.outbox.enqueue(
                tx,
                qActionEvent(
                  QActionRejectedEvent,
                  eventContext(
                    moved,
                    { type: "HUMAN", id: actor.userId },
                    correlationId,
                  ),
                  eventData(moved, approval.id),
                ),
              );
            }
            metrics.approvalsRejected.add(1, {
              action_type: action.actionType,
            });
            outcome = "rejected";
            return {
              view: toApprovalView(decided, moved, now),
              decided: true,
              action: moved,
              approval: decided,
            };
          });
          if ("lapsed" in result) {
            throw new QApprovalExpiredError();
          }
          logger?.info(
            {
              approvalId: command.approvalId,
              actionId: result.action.id,
              qRunId: result.action.runId,
              decision,
              outcome,
              correlationId,
            },
            "q approval decided",
          );
          return result;
        } finally {
          span.setAttribute("q.outcome", outcome);
          span.end();
        }
      },
    );
  }

  function humanActor(actor: ActorContext) {
    return {
      tenantId: actor.tenantId,
      actorType: "HUMAN" as const,
      actorId: actor.userId,
      authorityUserId: actor.userId,
      organisationId: actor.organisationId,
    };
  }

  const executeApproved: QActionService["executeApproved"] = async (
    context,
  ) => {
    const { actor, correlationId } = context;
    return tracer.startActiveSpan(
      "q.action.execute",
      {
        attributes: {
          "q.run_id": context.runId,
          "q.action.id": context.actionId,
        },
      },
      async (span) => {
        let outcomeLabel = "unknown";
        const finish = (
          outcome: QActionExecuteOutcome,
        ): QActionExecuteOutcome => {
          outcomeLabel = outcome.kind;
          metrics.executions.add(1, { outcome: outcome.kind });
          logger?.info(
            {
              qRunId: context.runId,
              actionId: context.actionId,
              outcome: outcome.kind,
              ...("failureCode" in outcome
                ? { failureCode: outcome.failureCode }
                : {}),
              ...("reason" in outcome ? { reason: outcome.reason } : {}),
              correlationId,
            },
            "q action execution gate returned",
          );
          return outcome;
        };
        try {
          // 1. The canonical action, in this tenant, for this run.
          const action = await repositories.actions.findById(
            sql,
            context.tenantId,
            context.actionId,
          );
          if (action === null || action.runId !== context.runId) {
            return finish({ kind: "BLOCKED", reason: "ACTION_NOT_FOUND" });
          }
          switch (action.status) {
            case "EXECUTED":
              metrics.duplicateExecutionPrevented.add(1, { stage: "read" });
              return finish({ kind: "ALREADY_EXECUTED" });
            case "EXECUTING":
              metrics.duplicateExecutionPrevented.add(1, { stage: "read" });
              return finish({ kind: "IN_PROGRESS" });
            case "RECONCILIATION_REQUIRED":
              return finish({
                kind: "RECONCILIATION_REQUIRED",
                failureCode: action.failureCode ?? "OUTCOME_UNKNOWN",
              });
            case "REJECTED":
            case "EXPIRED":
            case "WITHDRAWN":
            case "PROPOSED":
            case "AWAITING_APPROVAL":
              return finish({ kind: "NOT_APPROVED", reason: action.status });
            case "FAILED":
              if (!action.retryPermitted) {
                return finish({
                  kind: "FAILED",
                  failureCode: action.failureCode ?? "EXECUTION_FAILED",
                });
              }
              break;
            case "APPROVED":
              break;
          }

          // 2. A usable approval: APPROVED, by a person, not lapsed.
          const approvals = await repositories.approvals.listForAction(
            sql,
            context.tenantId,
            action.id,
          );
          const approval = approvals.find((a) => a.status === "APPROVED");
          const now = clock.now();
          if (
            approval === undefined ||
            approval.approvedByUserId === null ||
            approval.approvalPayloadHash === null
          ) {
            return finish({ kind: "NOT_APPROVED", reason: "NO_APPROVAL" });
          }
          if (!approvalIsUsable(approval, now)) {
            await transactions.run(async (tx) => {
              const locked = await repositories.actions.lockById(
                tx,
                action.tenantId,
                action.id,
              );
              if (
                locked !== null &&
                (locked.status === "APPROVED" || locked.status === "FAILED")
              ) {
                await repositories.actions.transition(tx, {
                  tenantId: locked.tenantId,
                  actionId: locked.id,
                  expectedVersion: locked.version,
                  status: "EXPIRED",
                });
              }
            });
            metrics.approvalsExpired.add(1, { action_type: action.actionType });
            return finish({ kind: "NOT_APPROVED", reason: "APPROVAL_EXPIRED" });
          }

          // 3. Reauthorize now: the executing person is the approver, and
          //    holds both the approve capability and the action's own
          //    permission at this instant. Revoked authority blocks.
          const definition = registry.get(action.actionType);
          if (
            definition === undefined ||
            definition.version !== action.actionVersion
          ) {
            return finish({
              kind: "BLOCKED",
              reason: "DEFINITION_UNAVAILABLE",
            });
          }
          const blocked = async (
            reason: string,
          ): Promise<QActionExecuteOutcome> => {
            metrics.reauthorizationBlocks.add(1, { reason });
            await securityEvent({
              type: SECURITY_EXECUTION_BLOCKED,
              severity: "HIGH",
              actor,
              resourceType: RESOURCE_Q_ACTION,
              resourceId: action.id,
              reason,
              correlationId,
            });
            await transactions.run((tx) =>
              audit.record(tx, {
                auditEventId: createAuditEventId(),
                tenantId: action.tenantId,
                actorType: "Q",
                actorId: action.runId,
                authorityUserId: approval.approvedByUserId ?? undefined,
                organisationId: action.organisationId ?? undefined,
                actionType: AUDIT.executionBlocked,
                resourceType: RESOURCE_Q_ACTION,
                resourceId: action.id,
                occurredAt: iso(clock.now()),
                outcome: "DENIED",
                metadata: auditMetadata(action, {
                  approvalId: approval.id,
                  reason,
                }),
                correlationId,
              }),
            );
            return finish({ kind: "BLOCKED", reason });
          };
          if (
            actor.actorType !== "HUMAN" ||
            actor.userId !== approval.approvedByUserId ||
            actor.tenantId !== action.tenantId ||
            (actor.organisationId ?? null) !== action.organisationId
          ) {
            return blocked("EXECUTING_ACTOR_IS_NOT_APPROVER");
          }
          const authority = await approverAuthority(actor, action, definition);
          if (!authority.ok) {
            return blocked(`AUTHORITY_REVOKED:${authority.reason}`);
          }

          // 4. proposed = approved = about-to-execute, recomputed from the row.
          const recomputed = hashBindingEnvelope(envelopeOf(action));
          if (
            !hashesMatch(recomputed, action.payloadHash) ||
            !hashesMatch(recomputed, approval.approvalPayloadHash)
          ) {
            metrics.hashMismatchBlocks.add(1, { stage: "execute" });
            await securityEvent({
              type: SECURITY_HASH_MISMATCH,
              severity: "HIGH",
              actor,
              resourceType: RESOURCE_Q_ACTION,
              resourceId: action.id,
              reason: "payload_hash_mismatch_at_execution",
              correlationId,
            });
            return blocked("PAYLOAD_HASH_MISMATCH");
          }
          if (action.executionAttempts >= policy.maxExecutionAttempts) {
            return finish({
              kind: "FAILED",
              failureCode: "EXECUTION_ATTEMPTS_EXHAUSTED",
            });
          }

          // 5. Claim atomically: exactly one worker leaves this transaction
          //    holding EXECUTING for this version of the row.
          const claim = await transactions.run(async (tx) => {
            const locked = await repositories.actions.lockById(
              tx,
              action.tenantId,
              action.id,
            );
            if (locked === null) {
              return { kind: "LOST" as const, status: null };
            }
            if (
              locked.status !== "APPROVED" &&
              !(locked.status === "FAILED" && locked.retryPermitted)
            ) {
              return { kind: "LOST" as const, status: locked.status };
            }
            if (!hashesMatch(locked.payloadHash, recomputed)) {
              return { kind: "LOST" as const, status: locked.status };
            }
            assertActionTransition(locked.status, "EXECUTING");
            // A retry after a definite failure starts clean: the earlier
            // failure code and retry permission belong to that attempt, and
            // the finalise step records this attempt's own outcome.
            const claimed = await repositories.actions.transition(tx, {
              tenantId: locked.tenantId,
              actionId: locked.id,
              expectedVersion: locked.version,
              status: "EXECUTING",
              failureCode: null,
              retryPermitted: false,
              incrementAttempts: true,
            });
            return claimed === null
              ? { kind: "LOST" as const, status: locked.status }
              : { kind: "CLAIMED" as const, action: claimed };
          });
          if (claim.kind === "LOST") {
            metrics.duplicateExecutionPrevented.add(1, { stage: "claim" });
            if (claim.status === "EXECUTED")
              return finish({ kind: "ALREADY_EXECUTED" });
            if (claim.status === "EXECUTING")
              return finish({ kind: "IN_PROGRESS" });
            return finish({
              kind: "NOT_APPROVED",
              reason: claim.status ?? "ACTION_NOT_FOUND",
            });
          }
          const claimed = claim.action;
          span.setAttribute("q.action.attempt", claimed.executionAttempts);

          // 6. The deterministic executor, outside any transaction, once.
          const parsedPayload = definition.payload.parse(claimed.payload);
          const approved: ApprovedQAction<unknown> = {
            actionId: claimed.id,
            runId: claimed.runId,
            tenantId: claimed.tenantId,
            organisationId: claimed.organisationId,
            actionType: claimed.actionType,
            actionVersion: claimed.actionVersion,
            targets: claimed.targets,
            payload: parsedPayload,
            idempotencyKey: claimed.idempotencyKey,
            payloadHash: claimed.payloadHash,
            approvalId: approval.id,
            approvedByUserId: approval.approvedByUserId,
          };
          let report: Awaited<ReturnType<typeof definition.executor.execute>>;
          try {
            report = await definition.executor.execute(approved, {
              correlationId,
              attempt: claimed.executionAttempts,
              signal: context.signal,
            });
          } catch (error: unknown) {
            // A throw is not a definite failure: the side effect may have
            // happened. Never resend; reconcile.
            // The class of the fault, never its text: an executor's
            // message may describe a provider, a recipient or worse.
            logger?.error(
              {
                actionId: claimed.id,
                qRunId: claimed.runId,
                errorName: error instanceof Error ? error.name : typeof error,
              },
              "q action executor threw",
            );
            report = { outcome: "UNKNOWN", failureCode: "EXECUTOR_THREW" };
          }

          // 7. Finalise: the persisted status is the only statement of success.
          const finalised = await transactions.run(async (tx) => {
            const locked = await repositories.actions.lockById(
              tx,
              claimed.tenantId,
              claimed.id,
            );
            if (locked === null || locked.status !== "EXECUTING") {
              throw new QActionVersionConflictError();
            }
            const finishedAt = iso(clock.now());
            if (report.outcome === "EXECUTED") {
              const result = definition.result.safeParse(report.result);
              if (!result.success) {
                // The executor ran but reported something its own contract
                // refuses: the outcome is unknown to us, and stays so.
                const moved = await repositories.actions.transition(tx, {
                  tenantId: locked.tenantId,
                  actionId: locked.id,
                  expectedVersion: locked.version,
                  status: "RECONCILIATION_REQUIRED",
                  failureCode: "INVALID_EXECUTOR_RESULT",
                });
                return moved ?? locked;
              }
              assertActionTransition(locked.status, "EXECUTED");
              const moved = await repositories.actions.transition(tx, {
                tenantId: locked.tenantId,
                actionId: locked.id,
                expectedVersion: locked.version,
                status: "EXECUTED",
                executedAt: finishedAt,
                executionResult: result.data as Record<string, unknown>,
                failureCode: null,
              });
              if (moved === null) {
                throw new QActionVersionConflictError();
              }
              await audit.record(tx, {
                auditEventId: createAuditEventId(),
                tenantId: moved.tenantId,
                actorType: "Q",
                actorId: moved.runId,
                authorityUserId: approved.approvedByUserId,
                organisationId: moved.organisationId ?? undefined,
                actionType: AUDIT.executed,
                resourceType: RESOURCE_Q_ACTION,
                resourceId: moved.id,
                occurredAt: finishedAt,
                outcome: "SUCCEEDED",
                metadata: auditMetadata(moved, {
                  approvalId: approval.id,
                  attempt: moved.executionAttempts,
                }),
                correlationId,
              });
              if (dependencies.outbox !== undefined) {
                await dependencies.outbox.enqueue(
                  tx,
                  qActionEvent(
                    QActionExecutedEvent,
                    eventContext(
                      moved,
                      { type: "Q", id: moved.runId },
                      correlationId,
                    ),
                    eventData(moved, approval.id),
                  ),
                );
              }
              return moved;
            }
            const status: QActionStatus =
              report.outcome === "FAILED"
                ? "FAILED"
                : "RECONCILIATION_REQUIRED";
            assertActionTransition(locked.status, status);
            const moved = await repositories.actions.transition(tx, {
              tenantId: locked.tenantId,
              actionId: locked.id,
              expectedVersion: locked.version,
              status,
              failureCode: report.failureCode,
              retryPermitted:
                report.outcome === "FAILED" ? report.retryable : false,
            });
            if (moved === null) {
              throw new QActionVersionConflictError();
            }
            await audit.record(tx, {
              auditEventId: createAuditEventId(),
              tenantId: moved.tenantId,
              actorType: "Q",
              actorId: moved.runId,
              authorityUserId: approved.approvedByUserId,
              organisationId: moved.organisationId ?? undefined,
              actionType: AUDIT.executionFailed,
              resourceType: RESOURCE_Q_ACTION,
              resourceId: moved.id,
              occurredAt: finishedAt,
              outcome: "FAILED",
              metadata: auditMetadata(moved, {
                approvalId: approval.id,
                attempt: moved.executionAttempts,
                failureCode: report.failureCode,
                retryPermitted: moved.retryPermitted,
                outcomeKnown: report.outcome === "FAILED",
              }),
              correlationId,
            });
            if (dependencies.outbox !== undefined) {
              await dependencies.outbox.enqueue(
                tx,
                qActionEvent(
                  QActionExecutionFailedEvent,
                  eventContext(
                    moved,
                    { type: "Q", id: moved.runId },
                    correlationId,
                  ),
                  {
                    ...eventData(moved, approval.id),
                    failureCode: report.failureCode,
                    retryPermitted: moved.retryPermitted,
                  },
                ),
              );
            }
            return moved;
          });

          // The finalise transaction only ever leaves EXECUTED, FAILED or
          // RECONCILIATION_REQUIRED; anything else is reported as unknown.
          if (finalised.status === "EXECUTED") {
            return finish({ kind: "EXECUTED" });
          }
          if (finalised.status === "FAILED") {
            return finish({
              kind: "FAILED",
              failureCode: finalised.failureCode ?? "EXECUTION_FAILED",
            });
          }
          return finish({
            kind: "RECONCILIATION_REQUIRED",
            failureCode: finalised.failureCode ?? "OUTCOME_UNKNOWN",
          });
        } finally {
          span.setAttribute("q.outcome", outcomeLabel);
          span.end();
        }
      },
    );
  };

  return {
    propose,
    getApproval,
    approve: (command) => decide(command, "APPROVED"),
    reject: (command) => decide(command, "REJECTED"),
    executeApproved,
    findApprovalForAction: async (tenantId, actionId) => {
      const approvals = await repositories.approvals.listForAction(
        sql,
        tenantId,
        actionId,
      );
      return approvals[0] ?? null;
    },
  };
}

export { QActionAlreadyCompletedError };
