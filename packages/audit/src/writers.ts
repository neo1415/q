import type { TransactionContext } from "@capital-q/database";

import type { AuditEventId } from "./contracts/ids.js";
import type { MaterialActionAuditInput } from "./contracts/material-action.js";
import type { SecurityEventInput } from "./contracts/security-event.js";

/**
 * Records accountability for a material action inside the caller's
 * transaction. The transaction is required, not optional: a domain that
 * mutates state, records audit and enqueues its event in one
 * `transactions.run` commits or rolls back all three together.
 *
 *   await transactions.run(async (tx) => {
 *     await repository.update(tx, ...);
 *     await audit.record(tx, { ...auditActorFromContext(actor), ... });
 *     await outbox.enqueue(tx, event);
 *   });
 *
 * There is deliberately no `record(input)` that opens its own transaction.
 * The infrastructure cannot know which future mutations are material; the
 * owning packet calls this where accountability is required.
 *
 * Returns the AuditEventId. Writing the same id with the same content again
 * (a retried command) is idempotent; the same id with different content is
 * an AuditEventConflictError.
 */
export type MaterialActionAuditWriter = {
  readonly record: (
    tx: TransactionContext,
    input: MaterialActionAuditInput,
  ) => Promise<AuditEventId>;
};

/**
 * Records a security monitoring event as one short independent write. A
 * denied request has no business transaction to join, and a failure to
 * record a low-severity event never turns a denial into an allow: the
 * authorization decision stays authoritative and the caller logs the
 * persistence failure safely.
 */
export type SecurityEventWriter = {
  readonly record: (input: SecurityEventInput) => Promise<AuditEventId>;
};
