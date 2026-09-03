import type { CompanyQueryPort } from "@capital-q/companies";
import type { InvestorOrganisationQueryPort } from "@capital-q/investors";
import {
  RelationshipIdSchema,
  type RelationshipQueryPort,
} from "@capital-q/network";

import type { RelationshipPartyResolver } from "./ports.js";

/**
 * The exact legitimate parties of one canonical relationship: the company's
 * owning organisation (in the company's tenant) and the investor
 * organisation's underlying organisation (in its own tenant). Resolved
 * through public query ports only. The relationship's storage tenant is
 * not consulted for access: ADR 0003 makes it an anchor, not a rule.
 */
export function createRelationshipPartyResolver(ports: {
  readonly relationships: RelationshipQueryPort;
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
}): RelationshipPartyResolver {
  return {
    resolve: async (relationshipId) => {
      const parsedId = RelationshipIdSchema.safeParse(relationshipId);
      if (!parsedId.success) {
        return null;
      }
      const relationship = await ports.relationships.getById(parsedId.data);
      if (relationship === null) {
        return null;
      }
      const [company, investor] = await Promise.all([
        ports.companies.findCanonicalCompany(relationship.companyId),
        ports.investors.findCanonicalInvestorOrganisation(
          relationship.investorOrganisationId,
        ),
      ]);
      // A relationship whose party can no longer be resolved has no
      // parties: fail closed rather than trust half a relationship.
      if (company === null || investor === null) {
        return null;
      }
      return {
        relationshipId: relationship.id,
        company: {
          organisationId: company.organisationId,
          tenantId: company.tenantId,
        },
        investor: {
          organisationId: investor.organisationId,
          tenantId: investor.tenantId,
        },
      };
    },
  };
}
