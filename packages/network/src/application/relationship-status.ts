import { CompanyIdSchema } from "@capital-q/companies";
import {
  UtcTimestampSchema,
  type RelationshipStatusDto,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import { RelationshipIdSchema, type Relationship } from "../contracts/index.js";
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

/** One row of a party's list: the fold, plus the counterpart's name. */
export type RelationshipListing = RelationshipStatus & {
  readonly counterpartName: string;
};

const LIST_LIMIT = 200;

/** An investor organisation's own relationships, each folded for its side. */
export function createListRelationshipsForInvestor(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
  }): Promise<readonly RelationshipListing[]> => {
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
    const relationships =
      await dependencies.repositories.relationships.listByInvestorOrganisation(
        dependencies.sql,
        investorOrganisationId,
        LIST_LIMIT,
      );
    const out: RelationshipListing[] = [];
    for (const relationship of relationships) {
      // The same rule as the single read: a company that has since gone
      // out of this investor's sight is not listed.
      if (
        !(await dependencies.companyVisibility.isVisibleToInvestor(
          actor,
          relationship.companyId,
        ))
      ) {
        continue;
      }
      const company = await dependencies.companies.findCanonicalCompany(
        relationship.companyId,
      );
      const view = viewOf(
        relationship,
        await readHistory(dependencies, relationship.id),
        "INVESTOR",
      );
      if (company !== null && view !== null) {
        out.push({ ...view, counterpartName: company.canonicalName });
      }
    }
    return out;
  };
}

/** A company's own relationships: only those its side can see anything of. */
export function createListRelationshipsForCompany(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }): Promise<readonly RelationshipListing[]> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new ActorContextRequiredError();
    }
    const companyId = CompanyIdSchema.safeParse(query.companyId);
    if (!companyId.success) throw new InterestCompanyNotFoundError();
    const company = await dependencies.companies.findCanonicalCompany(
      companyId.data,
    );
    if (
      company === null ||
      company.tenantId !== actor.tenantId ||
      company.organisationId !== actor.organisationId
    ) {
      throw new InterestCompanyNotFoundError();
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
    const relationships =
      await dependencies.repositories.relationships.listByCompany(
        dependencies.sql,
        company.id,
        LIST_LIMIT,
      );
    const out: RelationshipListing[] = [];
    for (const relationship of relationships) {
      const view = viewOf(
        relationship,
        await readHistory(dependencies, relationship.id),
        "COMPANY",
      );
      // Nothing visible to the company: an investor's private discovery.
      if (view === null) continue;
      const investor =
        await dependencies.investors.findCanonicalInvestorOrganisation(
          relationship.investorOrganisationId,
        );
      if (investor !== null) {
        out.push({ ...view, counterpartName: investor.displayName });
      }
    }
    return out;
  };
}

/** The wire row. */
export function toRelationshipSummaryDto(
  listing: RelationshipListing,
  side: "INVESTOR" | "COMPANY",
): RelationshipSummaryDto {
  return {
    relationshipId: listing.relationship.id,
    counterpart:
      side === "INVESTOR"
        ? {
            kind: "COMPANY",
            id: listing.relationship.companyId,
            name: listing.counterpartName,
          }
        : {
            kind: "INVESTOR_ORGANISATION",
            id: listing.relationship.investorOrganisationId,
            name: listing.counterpartName,
          },
    state: listing.projection.state,
    stateSince: UtcTimestampSchema.parse(listing.projection.stateSince),
    nextStep: listing.nextStep,
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

/** A relationship named by id, as the asking party sees it. */
export type RelationshipPartyView = {
  readonly side: RelationshipParty;
  readonly counterpart:
    | { readonly kind: "COMPANY"; readonly id: string }
    | { readonly kind: "INVESTOR_ORGANISATION"; readonly id: string };
  /** Null: nothing on record that this side may see. */
  readonly status: RelationshipStatus | null;
};

/**
 * One relationship, named by its id, for whichever party is asking (the
 * RELATIONSHIP Q subject). The id grants nothing: the actor's side is
 * decided here from their own membership, and the answer is exactly that
 * side's own view (the same use cases the screens call), so a company
 * reading by id still never sees an investor's private discovery. A
 * relationship the actor is not a party to is null, the same as one that
 * does not exist.
 */
export function createRelationshipById(
  dependencies: ExpressInterestDependencies,
) {
  const forInvestor = createRelationshipForInvestor(dependencies);
  const forCompany = createRelationshipForCompany(dependencies);
  return async (query: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
  }): Promise<RelationshipPartyView | null> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new ActorContextRequiredError();
    }
    const id = RelationshipIdSchema.safeParse(query.relationshipId);
    if (!id.success) return null;
    const relationship = await dependencies.repositories.relationships.findById(
      dependencies.sql,
      id.data,
    );
    if (relationship === null) return null;

    const company = await dependencies.companies.findCanonicalCompany(
      relationship.companyId,
    );
    if (
      company !== null &&
      company.tenantId === actor.tenantId &&
      company.organisationId === actor.organisationId
    ) {
      return {
        side: "COMPANY",
        counterpart: {
          kind: "INVESTOR_ORGANISATION",
          id: relationship.investorOrganisationId,
        },
        status: await forCompany({
          actor,
          investorOrganisationId: relationship.investorOrganisationId,
        }),
      };
    }

    const investor =
      await dependencies.investorSubject.investorOrganisationFor(actor);
    if (
      investor?.investorOrganisationId === relationship.investorOrganisationId
    ) {
      return {
        side: "INVESTOR",
        counterpart: { kind: "COMPANY", id: relationship.companyId },
        status: await forInvestor({ actor, companyId: relationship.companyId }),
      };
    }
    return null;
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
