import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { ChatSafetyAuditPort } from "@capital-q/communication";

/**
 * Block, unblock and report on relationship chat are material actions
 * (R34 safety): who acted, for which organisation, on which relationship,
 * recorded inside the write's own transaction. AUDIT, not analytics. The
 * metadata carries the side, the reason code and whether a message was
 * named -- never a note or message words.
 */
export function createChatSafetyAudit(
  writer: MaterialActionAuditWriter,
): ChatSafetyAuditPort {
  return async (tx, entry) => {
    await writer.record(tx, {
      ...auditActorFromContext(entry.actor),
      auditEventId: createAuditEventId(),
      actionType: AuditActionTypeSchema.parse(entry.actionType),
      resourceType: AuditResourceTypeSchema.parse(entry.resourceType),
      resourceId: entry.resourceId,
      relationshipId: entry.relationshipId,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata: { ...entry.metadata },
    });
  };
}
