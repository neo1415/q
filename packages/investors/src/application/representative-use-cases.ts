import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type {
  CorrelationId,
  UpsertMyInvestorRepresentativeRequest,
} from "@capital-q/contracts";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import type {
  InvestorOrganisationId,
  InvestorRepresentative,
} from "../contracts/index.js";
import {
  InvestorRepresentativeNotFoundError,
  InvestorVersionConflictError,
} from "../domain/errors.js";
import {
  investorRepresentativeCreatedEvent,
  investorRepresentativeUpdatedEvent,
} from "../events/index.js";
import type { InvestorServiceDependencies } from "./dependencies.js";
import {
  INVESTOR_VIEW,
  investorScope,
  visibleInvestorOrganisation,
} from "./read-investor-organisation.js";

/**
 * Representative use cases -- the caller's own representation only.
 *
 * The person is always `actor.userId` and the capacity is always
 * `actor.membershipId`, both resolved server-side from trusted rows: no
 * operation here takes a UserId or MembershipId from outside. Nothing here
 * reads or writes organisation roles; a business title is presentation and
 * is never evaluated for permission.
 */

export const INVESTOR_REPRESENTATIVE_SELF_EDIT = capability(
  "investor.representative.self_edit",
);

const RESOURCE_REPRESENTATIVE = AuditResourceTypeSchema.parse(
  "investor_representative",
);
const ACTION = {
  created: AuditActionTypeSchema.parse("investor_representative.created"),
  updated: AuditActionTypeSchema.parse("investor_representative.updated"),
};

type Scoped = {
  readonly actor: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
};

export type GetMyInvestorRepresentativeQuery = Scoped;

export function createGetMyInvestorRepresentative(
  dependencies: InvestorServiceDependencies,
) {
  return async (
    query: GetMyInvestorRepresentativeQuery,
  ): Promise<InvestorRepresentative> => {
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      query.actor,
      query.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: INVESTOR_VIEW,
      resource: investorScope(query.actor, organisationId, investor.id),
    });
    const representative =
      await dependencies.repositories.representatives.findCurrentForUser(
        dependencies.sql,
        query.actor.tenantId,
        investor.id,
        query.actor.userId,
      );
    if (representative === null) {
      throw new InvestorRepresentativeNotFoundError();
    }
    return representative;
  };
}

export type UpsertMyInvestorRepresentativeCommand = Scoped & {
  readonly input: UpsertMyInvestorRepresentativeRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Establish or update the caller's own current representation. Idempotent:
 * the target row is (investor organisation, caller). A first call, or a
 * call after every earlier period has ended, opens a new period bound to
 * the caller's active membership; ended periods are never reopened. This
 * creates no organisation membership, changes no role and grants nothing.
 */
export function createUpsertMyInvestorRepresentative(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;

  return async (
    command: UpsertMyInvestorRepresentativeCommand,
  ): Promise<InvestorRepresentative> => {
    const { actor, input } = command;
    if (actor.membershipId === undefined) {
      throw new ActorContextRequiredError();
    }
    const membershipId = actor.membershipId;
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      actor,
      command.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: INVESTOR_REPRESENTATIVE_SELF_EDIT,
      resource: investorScope(actor, organisationId, investor.id),
    });

    const context = {
      tenantId: actor.tenantId,
      organisationId,
      actorUserId: actor.userId,
      correlationId: command.correlationId,
    };

    return transactions.run(async (tx) => {
      const current = await repositories.representatives.lockCurrentForUser(
        tx,
        actor.tenantId,
        investor.id,
        actor.userId,
      );

      if (current === null) {
        const representative = await repositories.representatives.create(tx, {
          tenantId: actor.tenantId,
          investorOrganisationId: investor.id,
          organisationId,
          userId: actor.userId,
          membershipId,
          businessTitle: input.businessTitle ?? null,
        });
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.created,
          resourceType: RESOURCE_REPRESENTATIVE,
          resourceId: representative.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { investorOrganisationId: investor.id },
          correlationId: command.correlationId,
        });
        await outbox.enqueue(
          tx,
          investorRepresentativeCreatedEvent({
            ...context,
            investorRepresentativeId: representative.id,
            investorOrganisationId: investor.id,
            userId: actor.userId,
            membershipId,
            version: representative.version,
          }),
        );
        return representative;
      }

      const title = input.businessTitle ?? null;
      if (title === current.businessTitle) {
        return current;
      }

      const updated = await repositories.representatives.updateCurrent(tx, {
        tenantId: actor.tenantId,
        investorRepresentativeId: current.id,
        expectedVersion: current.version,
        changes: { businessTitle: title },
      });
      if (updated === null) {
        throw new InvestorVersionConflictError(
          current.version,
          "representation",
        );
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.updated,
        resourceType: RESOURCE_REPRESENTATIVE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          investorOrganisationId: investor.id,
          changedFields: ["businessTitle"],
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        investorRepresentativeUpdatedEvent({
          ...context,
          investorRepresentativeId: updated.id,
          investorOrganisationId: investor.id,
          version: updated.version,
          changedFields: ["businessTitle"],
        }),
      );
      return updated;
    });
  };
}
