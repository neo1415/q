import { capability, type ActorContext } from "@capital-q/security";

import type {
  InvestorOrganisation,
  InvestorOrganisationId,
} from "../contracts/index.js";
import { InvestorOrganisationNotFoundError } from "../domain/errors.js";
import type { InvestorServiceDependencies } from "./dependencies.js";

export const INVESTOR_VIEW = capability("investor.view");

export function investorScope(
  actor: ActorContext,
  organisationId: NonNullable<ActorContext["organisationId"]>,
  investorOrganisationId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId,
    resourceType: "investor_organisation",
    resourceId: investorOrganisationId,
  };
}

/**
 * The investor organisation visible in the caller's tenant and active
 * organisation, or "not found". A row that exists elsewhere is not found,
 * identically to one that does not exist, before any authorization detail
 * could differ. Used by every read and write in this context.
 */
export async function visibleInvestorOrganisation(
  dependencies: InvestorServiceDependencies,
  actor: ActorContext,
  investorOrganisationId: InvestorOrganisationId,
): Promise<{
  investor: InvestorOrganisation;
  organisationId: NonNullable<ActorContext["organisationId"]>;
}> {
  if (actor.organisationId === undefined) {
    throw new InvestorOrganisationNotFoundError();
  }
  const investor = await dependencies.repositories.investors.findById(
    dependencies.sql,
    actor.tenantId,
    actor.organisationId,
    investorOrganisationId,
  );
  if (investor === null) {
    throw new InvestorOrganisationNotFoundError();
  }
  return { investor, organisationId: actor.organisationId };
}

export type GetInvestorOrganisationQuery = {
  readonly actor: ActorContext;
  /** Untrusted: the path parameter. */
  readonly investorOrganisationId: InvestorOrganisationId;
};

/** Organisation-internal canonical read: visibility first, then `investor.view` on the exact resource. */
export function createGetInvestorOrganisation(
  dependencies: InvestorServiceDependencies,
) {
  return async (
    query: GetInvestorOrganisationQuery,
  ): Promise<InvestorOrganisation> => {
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
    return investor;
  };
}

export type GetCurrentInvestorOrganisationQuery = {
  readonly actor: ActorContext;
};

/**
 * The investor organisation attached to the caller's active organisation.
 * "Not found" when none has been established -- the same answer as for a
 * missing context, so nothing is learned from the shape of the refusal.
 */
export function createGetCurrentInvestorOrganisation(
  dependencies: InvestorServiceDependencies,
) {
  return async (
    query: GetCurrentInvestorOrganisationQuery,
  ): Promise<InvestorOrganisation> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new InvestorOrganisationNotFoundError();
    }
    const investor =
      await dependencies.repositories.investors.findByOrganisation(
        dependencies.sql,
        actor.tenantId,
        actor.organisationId,
      );
    if (investor === null) {
      throw new InvestorOrganisationNotFoundError();
    }
    await dependencies.authorization.requireCapability({
      actor,
      capability: INVESTOR_VIEW,
      resource: investorScope(actor, actor.organisationId, investor.id),
    });
    return investor;
  };
}
