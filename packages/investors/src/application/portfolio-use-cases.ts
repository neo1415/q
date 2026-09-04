import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  ContractValidationError,
  type AddInvestorPortfolioReferenceRequest,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { InvestorOrganisationId } from "../contracts/index.js";
import type {
  InvestorPortfolioReference,
  InvestorPortfolioReferenceId,
} from "../contracts/portfolio.js";
import { InvestorPortfolioReferenceNotFoundError } from "../domain/errors.js";
import {
  investorPortfolioReferenceAddedEvent,
  investorPortfolioReferenceRemovedEvent,
} from "../events/index.js";
import type { InvestorServiceDependencies } from "./dependencies.js";
import {
  INVESTOR_VIEW,
  investorScope,
  visibleInvestorOrganisation,
} from "./read-investor-organisation.js";
import { INVESTOR_EDIT } from "./update-investor-organisation.js";

/**
 * Portfolio references (ADR 0007): representative companies an investor
 * names about itself. They are investor-private reference data -- never a
 * Capital Q Company, never a relationship, never a match, never public
 * until a later profile projection decides so. Events and audit carry
 * identifiers only; the company name stays in the row.
 */

const RESOURCE_PORTFOLIO_REFERENCE = AuditResourceTypeSchema.parse(
  "investor_portfolio_reference",
);
const ACTION = {
  added: AuditActionTypeSchema.parse("investor_portfolio_reference.added"),
  removed: AuditActionTypeSchema.parse("investor_portfolio_reference.removed"),
};

/**
 * A domain ceiling on current references, well above what onboarding
 * collects (five). Onboarding's smaller limit is journey UX, not domain
 * truth.
 */
export const INVESTOR_PORTFOLIO_REFERENCES_MAX = 100;

type Scoped = {
  readonly actor: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
};

export type ListInvestorPortfolioReferencesQuery = Scoped;

export type AddInvestorPortfolioReferenceCommand = Scoped & {
  /** Validated against AddInvestorPortfolioReferenceRequestSchema by the caller. */
  readonly input: AddInvestorPortfolioReferenceRequest;
  readonly correlationId: CorrelationId;
};

export type RemoveInvestorPortfolioReferenceCommand = Scoped & {
  readonly portfolioReferenceId: InvestorPortfolioReferenceId;
  readonly correlationId: CorrelationId;
};

export function createListInvestorPortfolioReferences(
  dependencies: InvestorServiceDependencies,
) {
  return async (
    query: ListInvestorPortfolioReferencesQuery,
  ): Promise<readonly InvestorPortfolioReference[]> => {
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
    return dependencies.repositories.portfolio.listCurrent(
      dependencies.sql,
      query.actor.tenantId,
      investor.id,
    );
  };
}

export function createAddInvestorPortfolioReference(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;
  return async (
    command: AddInvestorPortfolioReferenceCommand,
  ): Promise<InvestorPortfolioReference> => {
    const { actor, input } = command;
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      actor,
      command.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: INVESTOR_EDIT,
      resource: investorScope(actor, organisationId, investor.id),
    });
    return transactions.run(async (tx) => {
      const current = await repositories.portfolio.lockForInvestor(
        tx,
        actor.tenantId,
        investor.id,
      );
      if (current.length >= INVESTOR_PORTFOLIO_REFERENCES_MAX) {
        throw new ContractValidationError(
          "The portfolio reference list is full.",
          [
            {
              path: "companyName",
              code: "too_many",
              message: `at most ${String(INVESTOR_PORTFOLIO_REFERENCES_MAX)} portfolio references`,
            },
          ],
        );
      }
      const reference = await repositories.portfolio.insert(tx, {
        tenantId: actor.tenantId,
        investorOrganisationId: investor.id,
        companyName: input.companyName,
        websiteUrl: input.websiteUrl ?? null,
        createdByUserId: actor.userId,
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.added,
        resourceType: RESOURCE_PORTFOLIO_REFERENCE,
        resourceId: reference.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { investorOrganisationId: investor.id },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        investorPortfolioReferenceAddedEvent({
          tenantId: actor.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          investorOrganisationId: investor.id,
          portfolioReferenceId: reference.id,
          source: reference.source,
        }),
      );
      return reference;
    });
  };
}

export function createRemoveInvestorPortfolioReference(
  dependencies: InvestorServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;
  return async (
    command: RemoveInvestorPortfolioReferenceCommand,
  ): Promise<InvestorPortfolioReference> => {
    const { actor } = command;
    const { investor, organisationId } = await visibleInvestorOrganisation(
      dependencies,
      actor,
      command.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: INVESTOR_EDIT,
      resource: investorScope(actor, organisationId, investor.id),
    });
    return transactions.run(async (tx) => {
      const removed = await repositories.portfolio.remove(
        tx,
        actor.tenantId,
        investor.id,
        command.portfolioReferenceId,
      );
      if (removed === null) {
        throw new InvestorPortfolioReferenceNotFoundError();
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.removed,
        resourceType: RESOURCE_PORTFOLIO_REFERENCE,
        resourceId: removed.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { investorOrganisationId: investor.id },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        investorPortfolioReferenceRemovedEvent({
          tenantId: actor.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          investorOrganisationId: investor.id,
          portfolioReferenceId: removed.id,
        }),
      );
      return removed;
    });
  };
}
