import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type {
  CorrelationId,
  SetInvestorVisibilityRequest,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type {
  InvestorOrganisation,
  InvestorOrganisationId,
} from "../contracts/index.js";
import {
  INVESTOR_VISIBILITY_CHOICES,
  type InvestorVisibilityChoice,
} from "../domain/network-projection.js";
import {
  InvestorOrganisationNotFoundError,
  InvestorVersionConflictError,
} from "../domain/errors.js";
import { investorVisibilityChangedEvent } from "../events/index.js";
import { INVESTOR_EDIT } from "./update-investor-organisation.js";
import type { InvestorServiceDependencies } from "./dependencies.js";

const INVESTOR_VISIBILITY_CHANGED = AuditActionTypeSchema.parse(
  "investor_organisation.visibility_changed",
);
const INVESTOR_RESOURCE = AuditResourceTypeSchema.parse(
  "investor_organisation",
);

export type SetInvestorVisibilityCommand = {
  readonly actor: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
  /** Validated against SetInvestorVisibilityRequestSchema by the caller. */
  readonly input: SetInvestorVisibilityRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Publish the declared investor profile to founders across the network, or
 * take it back.
 *
 * The mirror of the founder's own switch, and deliberately the same shape:
 * an intentional act by an editor of the investor organisation, never a
 * side effect of finishing a mandate, of a portfolio import or of anything
 * Q read. The row's visibility is the single source the disclosure layer
 * and any founder-facing discovery read; nothing infers it from activity.
 *
 * What becoming visible does NOT do: expose the mandate, the portfolio,
 * observed behaviour or browsing. Those are separate decisions with their
 * own rules (doc 19 §44, §204.9). This switch governs the declared profile
 * and nothing else.
 */
export function createSetInvestorVisibility(
  dependencies: InvestorServiceDependencies,
) {
  const { sql, transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (
    command: SetInvestorVisibilityCommand,
  ): Promise<InvestorOrganisation> => {
    const { actor } = command;
    if (actor.organisationId === undefined) {
      throw new InvestorOrganisationNotFoundError();
    }
    const organisationId = actor.organisationId;
    const visibility: InvestorVisibilityChoice = command.input.visibility;
    if (!INVESTOR_VISIBILITY_CHOICES.includes(visibility)) {
      throw new InvestorOrganisationNotFoundError();
    }

    const visible = await repositories.investors.findById(
      sql,
      actor.tenantId,
      organisationId,
      command.investorOrganisationId,
    );
    if (visible === null) {
      throw new InvestorOrganisationNotFoundError();
    }

    await authorization.requireCapability({
      actor,
      capability: INVESTOR_EDIT,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId,
        resourceType: "investor_organisation",
        resourceId: visible.id,
      },
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
      // Already there: the same request twice is not a version conflict.
      if (current.visibility === visibility) {
        return current;
      }

      const updated = await repositories.investors.updateVisibility(tx, {
        tenantId: actor.tenantId,
        organisationId,
        investorOrganisationId: command.investorOrganisationId,
        expectedVersion: current.version,
        visibility,
      });
      if (updated === null) {
        throw new InvestorVersionConflictError(current.version);
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: INVESTOR_VISIBILITY_CHANGED,
        resourceType: INVESTOR_RESOURCE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          previousVisibility: current.visibility,
          visibility: updated.visibility,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        investorVisibilityChangedEvent({
          tenantId: actor.tenantId,
          organisationId,
          investorOrganisationId: updated.id,
          version: updated.version,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          visibility: updated.visibility,
        }),
      );

      return updated;
    });
  };
}
