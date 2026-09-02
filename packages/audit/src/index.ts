/**
 * @capital-q/audit
 *
 * Owns: audit record contracts and identifiers, the actor/authority mapping,
 * outcome and severity vocabularies, constrained safe metadata, the
 * material-action and security-event writer ports, their PostgreSQL
 * adapters and audit-specific errors.
 *
 * Does not own: Q memory, domain events, analytics, operational logging,
 * permission evaluation, or any domain rule. Audit records what happened
 * and under whose authority; it never decides whether it should have.
 *
 * Server-only. Never imported by browser-reachable code or the API client.
 *
 * Required domain pattern (documented here; owning packets call it):
 *
 *   await transactions.run(async (tx) => {
 *     await companyRepository.update(tx, company);
 *     await audit.record(tx, {
 *       ...auditActorFromContext(actor),
 *       auditEventId: createAuditEventId(),
 *       actionType: "company.profile.updated",
 *       resourceType: "company",
 *       resourceId: company.id,
 *       occurredAt: occurredNow(),
 *       outcome: "SUCCEEDED",
 *       metadata: { changedFields: ["stage"] },
 *       correlationId,
 *     });
 *     await outbox.enqueue(tx, companyUpdatedEvent);
 *   });
 */

export {
  AuditEventIdSchema,
  createAuditEventId,
  type AuditEventId,
} from "./contracts/ids.js";
export {
  AUDIT_OUTCOMES,
  AuditActionTypeSchema,
  AuditOutcomeSchema,
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
  HashReferenceSchema,
  PERSISTED_ACTOR_TYPES,
  PersistedActorTypeSchema,
  SECURITY_SEVERITIES,
  SecurityEventTypeSchema,
  SecuritySeveritySchema,
  toPersistedActorType,
  type AuditActionType,
  type AuditOutcome,
  type AuditResourceType,
  type PersistedActorType,
  type SecurityEventType,
  type SecuritySeverity,
} from "./contracts/vocabulary.js";
export {
  AUDIT_METADATA_MAX_ARRAY,
  AUDIT_METADATA_MAX_BYTES,
  AUDIT_METADATA_MAX_KEYS,
  AUDIT_METADATA_MAX_STRING,
  AuditMetadataSchema,
  FORBIDDEN_METADATA_TERMS,
  isForbiddenMetadataKey,
  type AuditMetadata,
} from "./contracts/metadata.js";
export {
  MaterialActionAuditInputSchema,
  type MaterialActionAuditInput,
  type MaterialActionAuditRecord,
} from "./contracts/material-action.js";
export {
  SecurityEventInputSchema,
  type SecurityEventInput,
  type SecurityEventRecord,
} from "./contracts/security-event.js";
export { auditActorFromContext, type HumanAuditActor } from "./actor.js";
export { occurredNow } from "./clock.js";
export {
  AuditActorError,
  AuditEventConflictError,
  AuditInputError,
} from "./errors.js";
export type {
  MaterialActionAuditWriter,
  SecurityEventWriter,
} from "./writers.js";
export { createPostgresMaterialActionAuditWriter } from "./postgres/material-action-writer.js";
export { createPostgresSecurityEventWriter } from "./postgres/security-event-writer.js";

export const PACKAGE_NAME = "@capital-q/audit" as const;
