import {
  CapitalObjectiveIdSchema,
  type CapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  FounderProfileIdSchema,
  type CompanyQueryPort,
} from "@capital-q/companies";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateQueryPort,
  type InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type RelationshipEvent,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { UserIdSchema } from "@capital-q/security";

import type {
  DisclosureResourceDescriptor,
  DisclosureResourceType,
} from "../contracts/index.js";
import type { DisclosureResourceResolver } from "./ports.js";

/**
 * Resolver adapters: one per resource kind, each reading ownership and the
 * intrinsic classification through the owning domain's public query port.
 *
 * Intrinsic scope strategy (§35-37, §168-172):
 *
 *   company            core.companies.marketplace_visibility (owned there)
 *   founder_profile    core.founder_profiles.visibility_scope (owned there);
 *                      Person-owned, anchored to the primary company's org
 *   investor_org       investor-side private by classification (no column)
 *   investor_mandate   investor-side private by classification (§170)
 *   capital_objective  company-side private by classification (§171)
 *   relationship       NO intrinsic scope: existence is not disclosure
 *                      (an investor's private discovery must not tell the
 *                      founder "Apex looked at you"); explicit policies only
 *   relationship_event the event's own visibility_scope (§172), owner by side
 *
 * None of these values is copied into permissions.disclosure_policies.
 */

function ref(type: DisclosureResourceType, id: string) {
  return { type, id } as const;
}

export function createCompanyDisclosureResolver(
  companies: CompanyQueryPort,
): DisclosureResourceResolver {
  return {
    resourceType: "company",
    resolve: async (resourceId) => {
      const id = CompanyIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const company = await companies.findCanonicalCompanyVisibility(id.data);
      if (company === null) {
        return null;
      }
      return {
        resource: ref("company", company.id),
        tenantId: company.tenantId,
        ownerOrganisationId: company.organisationId,
        intrinsicScope: company.marketplaceVisibility,
      };
    },
  };
}

export function createFounderProfileDisclosureResolver(
  companies: CompanyQueryPort,
): DisclosureResourceResolver {
  return {
    resourceType: "founder_profile",
    resolve: async (resourceId) => {
      const id = FounderProfileIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const profile = await companies.findCanonicalFounderProfile(id.data);
      if (profile === null) {
        return null;
      }
      const company =
        profile.primaryCompanyId === null
          ? null
          : await companies.findCanonicalCompany(profile.primaryCompanyId);
      const descriptor: DisclosureResourceDescriptor = {
        resource: ref("founder_profile", profile.id),
        tenantId: profile.tenantId,
        ownerUserId: profile.userId,
        // The company-side context the founder_private scope refers to.
        ownerOrganisationId: company?.organisationId,
        intrinsicScope: profile.visibilityScope,
      };
      return descriptor;
    },
  };
}

export function createInvestorOrganisationDisclosureResolver(
  investors: InvestorOrganisationQueryPort,
): DisclosureResourceResolver {
  return {
    resourceType: "investor_organisation",
    resolve: async (resourceId) => {
      const id = InvestorOrganisationIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const investor = await investors.findCanonicalInvestorOrganisation(
        id.data,
      );
      if (investor === null) {
        return null;
      }
      return {
        resource: ref("investor_organisation", investor.id),
        tenantId: investor.tenantId,
        ownerOrganisationId: investor.organisationId,
        intrinsicScope: "investor_private",
      };
    },
  };
}

export function createInvestorMandateDisclosureResolver(ports: {
  readonly mandates: InvestorMandateQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
}): DisclosureResourceResolver {
  return {
    resourceType: "investor_mandate",
    resolve: async (resourceId) => {
      const id = InvestorMandateIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const mandate = await ports.mandates.findCanonicalInvestorMandate(
        id.data,
      );
      if (mandate === null) {
        return null;
      }
      const investor = await ports.investors.findCanonicalInvestorOrganisation(
        mandate.investorOrganisationId,
      );
      if (investor === null) {
        return null;
      }
      return {
        resource: ref("investor_mandate", mandate.id),
        tenantId: mandate.tenantId,
        ownerOrganisationId: investor.organisationId,
        // Private by default; a future Investor Profile projects safe
        // fields deliberately. The raw mandate is never network-visible.
        intrinsicScope: "investor_private",
      };
    },
  };
}

export function createCapitalObjectiveDisclosureResolver(ports: {
  readonly capital: CapitalObjectiveQueryPort;
  readonly companies: CompanyQueryPort;
}): DisclosureResourceResolver {
  return {
    resourceType: "capital_objective",
    resolve: async (resourceId) => {
      const id = CapitalObjectiveIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const objective = await ports.capital.findCanonicalCapitalObjective(
        id.data,
      );
      if (objective === null) {
        return null;
      }
      const company = await ports.companies.findCanonicalCompany(
        objective.companyId,
      );
      if (company === null) {
        return null;
      }
      return {
        resource: ref("capital_objective", objective.id),
        tenantId: objective.tenantId,
        ownerOrganisationId: company.organisationId,
        // Company-side private; an ACTIVE objective is never automatically
        // network-visible. Founder onboarding (F10) decides later.
        intrinsicScope: "founder_private",
      };
    },
  };
}

export function createRelationshipDisclosureResolver(
  relationships: RelationshipQueryPort,
): DisclosureResourceResolver {
  return {
    resourceType: "relationship",
    resolve: async (resourceId) => {
      const id = RelationshipIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const relationship = await relationships.getById(id.data);
      if (relationship === null) {
        return null;
      }
      // No owner and no intrinsic scope: bilateral state whose existence is
      // not itself disclosed. Deliberate relationship_shared policies grant
      // both exact parties; nothing is granted by default.
      return {
        resource: ref("relationship", relationship.id),
        tenantId: relationship.tenantId,
        relationshipId: relationship.id,
      };
    },
  };
}

type EventOwnership = Pick<
  DisclosureResourceDescriptor,
  "ownerUserId" | "ownerOrganisationId" | "tenantId"
>;

/**
 * Which side owns an event follows its scope: founder_private belongs to
 * the company's organisation, investor_private to the investor's,
 * personal_private to the human actor who recorded it. organisation_private
 * cannot be attributed to a side from the event alone and stays unowned
 * (denied) rather than guessed.
 */
async function eventOwnership(
  event: RelationshipEvent,
  ports: {
    readonly relationships: RelationshipQueryPort;
    readonly companies: CompanyQueryPort;
    readonly investors: InvestorOrganisationQueryPort;
  },
): Promise<EventOwnership | null> {
  const relationship = await ports.relationships.getById(event.relationshipId);
  if (relationship === null) {
    return null;
  }
  switch (event.visibilityScope) {
    case "founder_private": {
      const company = await ports.companies.findCanonicalCompany(
        relationship.companyId,
      );
      return company === null
        ? null
        : {
            tenantId: company.tenantId,
            ownerOrganisationId: company.organisationId,
          };
    }
    case "investor_private": {
      const investor = await ports.investors.findCanonicalInvestorOrganisation(
        relationship.investorOrganisationId,
      );
      return investor === null
        ? null
        : {
            tenantId: investor.tenantId,
            ownerOrganisationId: investor.organisationId,
          };
    }
    case "personal_private": {
      const user =
        event.actor.type === "HUMAN"
          ? UserIdSchema.safeParse(event.actor.id)
          : null;
      return {
        tenantId: event.tenantId,
        ownerUserId: user !== null && user.success ? user.data : undefined,
      };
    }
    case "organisation_private":
    case "relationship_shared":
    case "specifically_shared":
    case "network_visible":
    case "public_external":
      return { tenantId: event.tenantId };
  }
}

export function createRelationshipEventDisclosureResolver(ports: {
  readonly relationships: RelationshipQueryPort;
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
}): DisclosureResourceResolver {
  return {
    resourceType: "relationship_event",
    resolve: async (resourceId) => {
      const id = RelationshipEventIdSchema.safeParse(resourceId);
      if (!id.success) {
        return null;
      }
      const event = await ports.relationships.getEventById(id.data);
      if (event === null) {
        return null;
      }
      const ownership = await eventOwnership(event, ports);
      if (ownership === null) {
        return null;
      }
      return {
        resource: ref("relationship_event", event.id),
        ...ownership,
        // The event's own scope is respected as recorded; never rewritten.
        intrinsicScope: event.visibilityScope,
        relationshipId: event.relationshipId,
      };
    },
  };
}

export type DisclosureDomainPorts = {
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly mandates: InvestorMandateQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
  readonly relationships: RelationshipQueryPort;
};

/** The full V1 resolver set, in one place, for the composition root. */
export function createDefaultDisclosureResolvers(
  ports: DisclosureDomainPorts,
): readonly DisclosureResourceResolver[] {
  return [
    createCompanyDisclosureResolver(ports.companies),
    createFounderProfileDisclosureResolver(ports.companies),
    createInvestorOrganisationDisclosureResolver(ports.investors),
    createInvestorMandateDisclosureResolver({
      mandates: ports.mandates,
      investors: ports.investors,
    }),
    createCapitalObjectiveDisclosureResolver({
      capital: ports.capital,
      companies: ports.companies,
    }),
    createRelationshipDisclosureResolver(ports.relationships),
    createRelationshipEventDisclosureResolver({
      relationships: ports.relationships,
      companies: ports.companies,
      investors: ports.investors,
    }),
  ];
}
