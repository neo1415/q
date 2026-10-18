import {
  CompanyIdSchema,
  type CompanyMarketplaceQueryPort,
} from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateRepository,
} from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";
import {
  TaxonomyNodeIdSchema,
  type TaxonomyAssignmentRepository,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import type {
  CompanyInvestmentFactsPort,
  InvestorMandateNarrativePort,
  VocabularyDescriptionPort,
} from "../semantic/ports.js";

/**
 * Semantic sources, assembled from the owning contexts' public ports. No
 * SQL here. Companies answers the investor-visible investment profile of
 * discoverable companies; Taxonomy answers a company's ACTIVE
 * classifications (under the company's own tenant) and names a node;
 * Investors answers the investor's own mandate narrative, tenant- and
 * organisation-scoped. There is no port to memory, conversations,
 * documents, evidence, research or Q, so none can reach a representation.
 */

export type DomainSemanticPortDependencies = {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly taxonomy: TaxonomyQueryPort;
  readonly mandates: InvestorMandateRepository;
};

export type DomainSemanticPorts = {
  readonly facts: CompanyInvestmentFactsPort;
  readonly narratives: InvestorMandateNarrativePort;
  readonly vocabulary: VocabularyDescriptionPort;
};

export function createDomainSemanticPorts(
  dependencies: DomainSemanticPortDependencies,
): DomainSemanticPorts {
  const { sql, companies, assignments, taxonomy, mandates } = dependencies;

  return {
    facts: {
      listDiscoverable: async (input) => {
        const profiles = await companies.listDiscoverableInvestmentProfiles({
          companyIds:
            input.companyIds === null
              ? null
              : input.companyIds.map((id) => CompanyIdSchema.parse(id)),
          limit: input.limit,
        });
        return Promise.all(
          profiles.map(async (profile) => {
            // ACTIVE classifications, read under the company's own tenant,
            // as the Taxonomy context requires.
            const rows = await assignments.listCurrent(
              sql,
              TenantIdSchema.parse(profile.tenantId),
              { subjectType: "COMPANY", subjectId: profile.id },
            );
            return {
              companyId: profile.id,
              tenantId: profile.tenantId,
              organisationId: profile.organisationId,
              canonicalName: profile.canonicalName,
              shortDescription: profile.shortDescription,
              currentStageCode: profile.currentStageCode,
              headquartersCountry: profile.headquartersCountry,
              sourceVersion: profile.version,
              classifications: rows.map((r) => ({
                nodeId: r.nodeId,
                vocabularyCode: r.vocabularyCode,
                canonicalCode: r.canonicalCode,
              })),
            };
          }),
        );
      },
    },

    narratives: {
      narrativeFor: async (input) => {
        // The repository read is tenant- and organisation-scoped: a mandate
        // that is not this investor's resolves as absent.
        const mandate = await mandates.findById(
          sql,
          TenantIdSchema.parse(input.tenantId),
          InvestorOrganisationIdSchema.parse(input.investorOrganisationId),
          InvestorMandateIdSchema.parse(input.mandateId),
        );
        if (mandate === null) return null;
        return {
          mandateId: mandate.id,
          version: mandate.version,
          name: mandate.name,
          rawMandateText: mandate.rawMandateText,
        };
      },
    },

    vocabulary: {
      describeNodes: async (nodeIds) => {
        if (nodeIds.length === 0) return [];
        const nodes = await taxonomy.findNodesByIds(
          nodeIds.map((id) => TaxonomyNodeIdSchema.parse(id)),
        );
        return nodes.map((n) => ({
          nodeId: n.id,
          vocabularyCode: n.vocabularyCode,
          canonicalCode: n.canonicalCode,
          displayName: n.displayName,
        }));
      },
    },
  };
}
