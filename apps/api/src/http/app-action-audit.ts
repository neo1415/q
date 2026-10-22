import { createHash } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditEventConflictError,
  AuditEventIdSchema,
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  occurredNow,
  type MaterialActionAuditInput,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { AnyAppAction, AppActionContext } from "@capital-q/app-actions";
import type { QSubjectRef } from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";

/**
 * Accountability for consequential actions a PERSON takes on a screen.
 *
 * The generated app-action route (app-actions.ts) is the one place a
 * person's direct action runs, so it is the one place this is recorded:
 * actor = that person, authority = that person, organisation = their
 * active organisation (all from the server-resolved actor context). Q's
 * path already audits itself (q.action.executed under the person's
 * authority) and does not come through here.
 *
 * - Idempotent: the audit event id is derived from (tenant, person,
 *   action, idempotency key), so a retried intent maps to the same record;
 *   the writer's event-id conflict on a retry (a later timestamp) is the
 *   record already being there, not a failure.
 * - Short: one INSERT in its own transaction, after the service has
 *   committed and returned. No transaction is held across the service's
 *   own work or any external call.
 * - Never content: no input, payload or body is recorded; only the action
 *   code, the first canonical target and the screen surface.
 * - Recording failures are reported, never turned into a failed response
 *   for an action that already happened.
 */

export type ScreenActionAudit = {
  readonly record: (entry: MaterialActionAuditInput) => Promise<void>;
};

function resourceOf(ref: QSubjectRef): readonly [string, string] {
  switch (ref.kind) {
    case "COMPANY":
      return ["company", ref.companyId];
    case "INVESTOR_ORGANISATION":
      return ["investor_organisation", ref.investorOrganisationId];
    case "RELATIONSHIP":
      return ["relationship", ref.relationshipId];
    case "CAPITAL_OBJECTIVE":
      return ["capital_objective", ref.capitalObjectiveId];
    case "DOCUMENT":
      return ["document", ref.documentId];
    case "USER":
      return ["user_profile", ref.userId];
    case "ORGANISATION":
      return ["organisation", ref.organisationId];
  }
}

/** A stable UUID (RFC 4122 layout, version 5 bits) for one intent. */
export function screenActionEventId(parts: readonly string[]): string {
  const hex = createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The audit record for a screen action, or null when it is not one we
 * record (a read, an instant personal toggle, or no organisation context).
 */
export function screenActionAuditEntry(
  action: AnyAppAction,
  context: AppActionContext,
  input: unknown,
  succeeded: boolean,
): MaterialActionAuditInput | null {
  if (action.classification !== "CONSEQUENTIAL") return null;
  if (context.surface !== "SCREEN") return null;
  const actor = context.actor;
  if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
    return null;
  }
  const eventId = AuditEventIdSchema.parse(
    screenActionEventId([
      "screen-action.v1",
      actor.tenantId,
      actor.userId,
      action.name,
      context.idempotencyKey,
    ]),
  );
  let target: QSubjectRef | undefined;
  try {
    target = action.targets(input)[0];
  } catch {
    target = undefined;
  }
  const [resourceType, resourceId] =
    target === undefined ? ["app_action", eventId] : resourceOf(target);
  return {
    ...auditActorFromContext(actor),
    auditEventId: eventId,
    actionType: AuditActionTypeSchema.parse(`app.${action.name}`),
    resourceType: AuditResourceTypeSchema.parse(resourceType),
    resourceId: AuditResourceIdSchema.parse(resourceId),
    occurredAt: occurredNow(),
    outcome: succeeded ? "SUCCEEDED" : "FAILED",
    metadata: { surface: "SCREEN" },
    correlationId: context.correlationId,
  };
}

export function createScreenActionAudit(options: {
  readonly transactions: TransactionManager;
  readonly audit: MaterialActionAuditWriter;
}): ScreenActionAudit {
  return {
    record: async (entry) => {
      try {
        await options.transactions.run((tx) => options.audit.record(tx, entry));
      } catch (error: unknown) {
        // The same intent, recorded already (a retry at a later instant).
        if (error instanceof AuditEventConflictError) return;
        throw error;
      }
    },
  };
}
