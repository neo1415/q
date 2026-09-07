import {
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  SecurityEventTypeSchema,
  type AuditResourceType,
} from "@capital-q/audit";
import type {
  CorrelationId,
  QConversationId,
  QRunId,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { QConversation, QRunRecord } from "../contracts/index.js";
import {
  QConversationNotFoundError,
  QRunNotFoundError,
} from "../domain/errors.js";
import type { QRuntimeDependencies } from "./dependencies.js";

/**
 * Ownership at the runtime boundary.
 *
 * A run or conversation is readable by exactly one person: the one who
 * owns it, in the tenant that holds it. Every lookup carries both. When a
 * row exists but belongs to someone else, the caller is told "not found"
 * — the same answer as for a row that never existed, so a response cannot
 * be used to enumerate other people's Q activity — and the refusal is
 * recorded as a security event with identifiers only.
 *
 * This is ownership, not the Context Firewall. It says whose conversation
 * this is; it says nothing about which knowledge may enter Q's reasoning.
 */

const PERMISSION_DENIED = SecurityEventTypeSchema.parse("permission_denied");
const RESOURCE_Q_RUN = AuditResourceTypeSchema.parse("q_run");
const RESOURCE_Q_CONVERSATION = AuditResourceTypeSchema.parse("q_conversation");

async function recordRefusal(
  dependencies: QRuntimeDependencies,
  actor: ActorContext,
  resource: {
    readonly type: AuditResourceType;
    readonly id: string;
  },
  correlationId: CorrelationId | undefined,
): Promise<void> {
  if (dependencies.securityEvents === undefined) {
    return;
  }
  try {
    await dependencies.securityEvents.record({
      auditEventId: createAuditEventId(),
      tenantId: actor.tenantId,
      userId: actor.userId,
      eventType: PERMISSION_DENIED,
      severity: "MEDIUM",
      resourceType: resource.type,
      resourceId: AuditResourceIdSchema.parse(resource.id),
      occurredAt: occurredNow(),
      metadata: { reason: "not_owner" },
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  } catch (error: unknown) {
    // A failure to record a refusal never turns it into an allow. The
    // denial stands; the persistence failure is logged without the
    // request's content.
    dependencies.logger?.warn(
      { err: error, resourceType: resource.type },
      "security event not recorded",
    );
  }
}

/** The run, or QRunNotFoundError. Records a refusal when the row is someone else's. */
export async function ownedRun(
  dependencies: QRuntimeDependencies,
  executor: DatabaseExecutor,
  actor: ActorContext,
  runId: QRunId,
  correlationId?: CorrelationId,
): Promise<QRunRecord> {
  const run = await dependencies.repositories.runs.findForActor(
    executor,
    actor.tenantId,
    actor.userId,
    runId,
  );
  if (run !== null) {
    return run;
  }
  await refuseRunIfForeign(dependencies, executor, actor, runId, correlationId);
  throw new QRunNotFoundError();
}

export async function refuseRunIfForeign(
  dependencies: QRuntimeDependencies,
  executor: DatabaseExecutor,
  actor: ActorContext,
  runId: QRunId,
  correlationId?: CorrelationId,
): Promise<void> {
  const ownership = await dependencies.repositories.runs.findOwnership(
    executor,
    runId,
  );
  if (ownership !== null) {
    await recordRefusal(
      dependencies,
      actor,
      { type: RESOURCE_Q_RUN, id: runId },
      correlationId,
    );
  }
}

/** The conversation, or QConversationNotFoundError, with the same refusal rule. */
export async function ownedConversation(
  dependencies: QRuntimeDependencies,
  executor: DatabaseExecutor,
  actor: ActorContext,
  conversationId: QConversationId,
  correlationId?: CorrelationId,
): Promise<QConversation> {
  const conversation =
    await dependencies.repositories.conversations.findForOwner(
      executor,
      actor.tenantId,
      actor.userId,
      conversationId,
    );
  if (conversation !== null) {
    return conversation;
  }
  const ownership = await dependencies.repositories.conversations.findOwnership(
    executor,
    conversationId,
  );
  if (ownership !== null) {
    await recordRefusal(
      dependencies,
      actor,
      { type: RESOURCE_Q_CONVERSATION, id: conversationId },
      correlationId,
    );
  }
  throw new QConversationNotFoundError();
}
