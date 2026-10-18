import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Scoped delegation (founder 2026-10-07): every step Q takes on its own
 * under a person's delegation is a material-action audit record, actor Q
 * under the person's authority, naming the delegation and the instruction:
 * "executed under delegation <id> by instruction <id>".
 */
const ACTION_TYPE = AuditActionTypeSchema.parse("q.delegation.step_executed");
const RESOURCE_TYPE = AuditResourceTypeSchema.parse("instruction_delegation");

export function createDelegationAudit(dependencies: {
  readonly transactions: TransactionManager;
  readonly audit: MaterialActionAuditWriter;
}) {
  return async (entry: {
    readonly actor: ActorContext;
    readonly delegationId: string;
    readonly instructionId: string;
    readonly action: string;
    readonly relationshipId: string | null;
    readonly idempotencyKey: string;
    readonly messageId: string | null;
  }): Promise<void> => {
    await dependencies.transactions.run((tx) =>
      dependencies.audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId: entry.actor.tenantId,
        actorType: "Q",
        authorityUserId: entry.actor.userId,
        ...(entry.actor.organisationId === undefined
          ? {}
          : { organisationId: entry.actor.organisationId }),
        actionType: ACTION_TYPE,
        resourceType: RESOURCE_TYPE,
        resourceId: entry.delegationId,
        ...(entry.relationshipId === null
          ? {}
          : { relationshipId: entry.relationshipId }),
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          summary: `executed under delegation ${entry.delegationId} by instruction ${entry.instructionId}`,
          delegationId: entry.delegationId,
          instructionId: entry.instructionId,
          appAction: entry.action,
          stepKey: entry.idempotencyKey.slice(0, 200),
          ...(entry.messageId === null ? {} : { messageId: entry.messageId }),
        },
      }),
    );
  };
}
