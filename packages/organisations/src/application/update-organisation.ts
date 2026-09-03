import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  ORGANISATION_EDITABLE_FIELDS,
  type CorrelationId,
  type OrganisationEditableField,
  type UpdateOrganisationRequest,
} from "@capital-q/contracts";
import {
  capability,
  type ActorContext,
  type OrganisationId,
} from "@capital-q/security";

import {
  OrganisationNotFoundError,
  OrganisationVersionConflictError,
} from "../domain/errors.js";
import type { Organisation } from "../domain/organisation.js";
import { organisationUpdatedEvent } from "../events/index.js";
import type { OrganisationServiceDependencies } from "./dependencies.js";
import type { OrganisationProfileChanges } from "./ports.js";

export const ORGANISATION_ADMIN = capability("organisation.admin");

const ORGANISATION_UPDATED = AuditActionTypeSchema.parse(
  "organisation.updated",
);
const ORGANISATION_RESOURCE = AuditResourceTypeSchema.parse("organisation");

export type UpdateOrganisationCommand = {
  readonly actor: ActorContext;
  readonly organisationId: OrganisationId;
  /** Validated against UpdateOrganisationRequestSchema by the caller. */
  readonly input: UpdateOrganisationRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Administer the organisation profile.
 *
 * Requires the caller's current organisation context to be the target
 * (enumeration-safe otherwise) and `organisation.admin` over it. The write
 * is optimistic: it applies only if the stored version equals the version
 * the caller read, then increments it. A stale caller gets a conflict, never
 * a silent overwrite. Type, status, tenant and slug are not editable here.
 */
export function createUpdateOrganisation(
  dependencies: OrganisationServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (command: UpdateOrganisationCommand): Promise<Organisation> => {
    const { actor } = command;
    if (
      actor.organisationId === undefined ||
      actor.organisationId !== command.organisationId
    ) {
      throw new OrganisationNotFoundError();
    }
    const organisationId = actor.organisationId;

    await authorization.requireCapability({
      actor,
      capability: ORGANISATION_ADMIN,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId,
      },
    });

    return transactions.run(async (tx) => {
      const current = await repositories.organisations.lockById(
        tx,
        actor.tenantId,
        organisationId,
      );
      if (current === null) {
        throw new OrganisationNotFoundError();
      }
      if (current.version !== command.input.expectedVersion) {
        throw new OrganisationVersionConflictError(current.version);
      }

      const changes = effectiveChanges(current, command.input);
      const changedFields = Object.keys(changes) as OrganisationEditableField[];
      if (changedFields.length === 0) {
        // Nothing would change: no version bump, no audit, no event.
        return current;
      }

      const updated = await repositories.organisations.updateProfile(tx, {
        tenantId: actor.tenantId,
        organisationId,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        // The row was locked above, so this only happens if the version
        // moved underneath the lock -- treat it as the conflict it is.
        throw new OrganisationVersionConflictError(current.version);
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ORGANISATION_UPDATED,
        resourceType: ORGANISATION_RESOURCE,
        resourceId: organisationId,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          changedFields: [...changedFields],
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        organisationUpdatedEvent({
          tenantId: actor.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          version: updated.version,
          changedFields,
        }),
      );

      return updated;
    });
  };
}

/** Only fields whose value actually differs from the stored profile. */
function effectiveChanges(
  current: Organisation,
  input: UpdateOrganisationRequest,
): OrganisationProfileChanges {
  const changes: Record<string, string | null> = {};
  for (const field of ORGANISATION_EDITABLE_FIELDS) {
    const next = input[field];
    if (next !== undefined && next !== current[field]) {
      changes[field] = next;
    }
  }
  return changes;
}
