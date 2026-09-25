import { CompanyIdSchema } from "@capital-q/companies";
import {
  UtcTimestampSchema,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import type { Relationship } from "../contracts/index.js";
import {
  InterestCompanyNotFoundError,
  InterestNotPermittedError,
} from "../domain/errors.js";
import {
  nextStepFor,
  projectRelationshipState,
  visibleToParty,
  type RelationshipNextStep,
  type RelationshipParty,
  type RelationshipProjection,
} from "../domain/state-projector.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { readHistory } from "./relationship-projection.js";
import { COMPANY_INTEREST_VIEW } from "./respond-to-interest.js";

const INVESTOR_VIEW = capability("investor.view");
const RELATIONSHIPS_SCAN = 200;

/**
 * "Where are we with X?" (CQ-NET-012; doc 25 §121, doc 17 §197).
 *
 * Each party's answer is folded by the same deterministic projector, but
 * only over the history that party may read: a company never learns of an
 * investor's private discovery, so a relationship that is only that is
 * nothing to the company. The cached `current_state` is the canonical,
 * all-history projection for the server's own use; it is never shown to a
 * party whose view it would widen.
 */
export type RelationshipStatus = {
  readonly relationship: Relationship;
  readonly projection: RelationshipProjection;
  readonly nextStep: RelationshipNextStep;
};

/** The wire shape: where are we, what happened, what is next. No payloads, no anomalies. */
export function toRelationshipStatusDto(
  status: RelationshipStatus,
): RelationshipStatusDto {
  return {
    relationshipId: status.relationship.id,
    companyId: status.relationship.companyId,
    investorOrganisationId: status.relationship.investorOrganisationId,
    state: status.projection.state,
    stateSince: UtcTimestampSchema.parse(status.projection.stateSince),
    milestones: status.projection.milestones.map((milestone) => ({
      state: milestone.state,
      at: UtcTimestampSchema.parse(milestone.at),
    })),
    nextStep: status.nextStep,
    projectorVersion: status.projection.version,
  };
}

function viewOf(
  relationship: Relationship,
  history: Parameters<typeof visibleToParty>[0],
  party: RelationshipParty,
): RelationshipStatus | null {
  const projection = projectRelationshipState(visibleToParty(history, party));
  return projection === null
    ? null
    : {
        relationship,
        projection,
        nextStep: nextStepFor(projection.state, party),
      };
}

/** The investor organisation's view of its relationship with a company. */
export function createRelationshipForInvestor(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }): Promise<RelationshipStatus | null> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new ActorContextRequiredError();
    }
    const subject =
      await dependencies.investorSubject.investorOrganisationFor(actor);
    if (subject === null) throw new InterestNotPermittedError();
    const investorOrganisationId = InvestorOrganisationIdSchema.parse(
      subject.investorOrganisationId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: INVESTOR_VIEW,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: "investor_organisation",
        resourceId: investorOrganisationId,
      },
    });
    const companyId = CompanyIdSchema.safeParse(query.companyId);
    if (
      !companyId.success ||
      !(await dependencies.companyVisibility.isVisibleToInvestor(
        actor,
        companyId.data,
      ))
    ) {
      throw new InterestCompanyNotFoundError();
    }
    const relationship =
      await dependencies.repositories.relationships.findByParties(
        dependencies.sql,
        companyId.data,
        investorOrganisationId,
      );
    if (relationship === null) return null;
    return viewOf(
      relationship,
      await readHistory(dependencies, relationship.id),
      "INVESTOR",
    );
  };
}

/** The company's view of its relationship with an investor organisation. */
export function createRelationshipForCompany(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
  }): Promise<RelationshipStatus | null> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new ActorContextRequiredError();
    }
    const investorOrganisationId = InvestorOrganisationIdSchema.safeParse(
      query.investorOrganisationId,
    );
    if (!investorOrganisationId.success) return null;
    // The company is the actor's own: found among the investor's
    // relationships by ownership, never named by the caller.
    const candidates =
      await dependencies.repositories.relationships.listByInvestorOrganisation(
        dependencies.sql,
        investorOrganisationId.data,
        RELATIONSHIPS_SCAN,
      );
    for (const relationship of candidates) {
      const company = await dependencies.companies.findCanonicalCompany(
        relationship.companyId,
      );
      if (
        company === null ||
        company.tenantId !== actor.tenantId ||
        company.organisationId !== actor.organisationId
      ) {
        continue;
      }
      await dependencies.authorization.requireCapability({
        actor,
        capability: COMPANY_INTEREST_VIEW,
        resource: {
          kind: "RESOURCE",
          tenantId: company.tenantId,
          organisationId: company.organisationId,
          resourceType: "company",
          resourceId: company.id,
        },
      });
      return viewOf(
        relationship,
        await readHistory(dependencies, relationship.id),
        "COMPANY",
      );
    }
    return null;
  };
}
