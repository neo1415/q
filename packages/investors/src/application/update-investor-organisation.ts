import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  INVESTOR_EDITABLE_FIELDS,
  type CorrelationId,
  type InvestorEditableField,
  type UpdateInvestorOrganisationRequest,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import type {
  InvestorOrganisation,
  InvestorOrganisationId,
} from "../contracts/index.js";
import {
  InvestorOrganisationNotFoundError,
  InvestorVersionConflictError,
} from "../domain/errors.js";
import { investorOrganisationUpdatedEvent } from "../events/index.js";
import type { InvestorServiceDependencies } from "./dependencies.js";
import type { InvestorProfileChanges } from "./ports.js";
import {
  investorScope,
  visibleInvestorOrganisation,
} from "./read-investor-organisation.js";

export const INVESTOR_EDIT = capability("investor.edit");

const ACTION_UPDATED = AuditActionTypeSchema.parse(
  "investor_organisation.updated",
);
const RESOURCE_INVESTOR = AuditResourceTypeSchema.parse(
  "investor_organisation",
);

export type UpdateInvestorOrganisationCommand = {
  readonly actor: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
  /** Validated against UpdateInvestorOrganisationRequestSchema by the caller. */
  readonly input: UpdateInvestorOrganisationRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Edit the investor profile or deployment state.
 *
 * Same tenant and active organisation (enumeration-safe otherwise),
 * `investor.edit` on the exact investor resource, then an optimistic write:
 * the row is locked, the stored version must equal `expectedVersion`, and
 * the update increments it. Verification state, tenant, organisation and
 * anything mandate-shaped are not reachable from here; a deployment-state
 * change touches no mandate, GateQ rule or recommendation state.
 */
export function createUpdateInvestorOrganisation(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: UpdateInvestorOrganisationCommand,
  ): Promise<InvestorOrganisation> => {
    const { actor } = command;
    const { investor: visible, organisationId } =
      await visibleInvestorOrganisation(
        dependencies,
        actor,
        command.investorOrganisationId,
      );

    await authorization.requireCapability({
      actor,
      capability: INVESTOR_EDIT,
      resource: investorScope(actor, organisationId, visible.id),
    });

    return transactions.run(async (tx) => {
      const current = await repositories.investors.lockById(
        tx,
        actor.tenantId,
        organisationId,
        command.investorOrganisationId,
      );
      if (current === null) {
        throw new InvestorOrganisationNotFoundError();
      }
      if (current.version !== command.input.expectedVersion) {
        throw new InvestorVersionConflictError(current.version);
      }

      const changes = effectiveChanges(current, command.input);
      const changedFields = Object.keys(changes) as InvestorEditableField[];
      if (changedFields.length === 0) {
        return current;
      }

      const updated = await repositories.investors.updateProfile(tx, {
        tenantId: actor.tenantId,
        organisationId,
        investorOrganisationId: command.investorOrganisationId,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        throw new InvestorVersionConflictError(current.version);
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_UPDATED,
        resourceType: RESOURCE_INVESTOR,
        resourceId: updated.id,
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
        investorOrganisationUpdatedEvent({
          tenantId: actor.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          investorOrganisationId: updated.id,
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
  current: InvestorOrganisation,
  input: UpdateInvestorOrganisationRequest,
): InvestorProfileChanges {
  const changes: Record<string, string | null> = {};
  for (const field of INVESTOR_EDITABLE_FIELDS) {
    const next = input[field];
    if (next !== undefined && next !== current[field]) {
      changes[field] = next;
    }
  }
  return changes;
}
