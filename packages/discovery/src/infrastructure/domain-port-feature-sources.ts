import {
  CompanyIdSchema,
  type CompanyMarketplaceQueryPort,
} from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";
import {
  TaxonomyNodeIdSchema,
  type TaxonomyAssignmentRepository,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import {
  GEOGRAPHY_VOCABULARY,
  UNRESTRICTED_GEOGRAPHY_CODE,
} from "../candidates/structured.js";
import type {
  CompanyFeatureProjectionPort,
  PreferenceHierarchyPort,
} from "../features/ports.js";

/**
 * Feature sources, assembled from the owning contexts' public ports and
 * tagged with the source class each one is. No SQL here. Companies answers
 * canonical state for discoverable companies in one batch; Taxonomy answers
 * a company's ACTIVE classifications (with their provenance, so the policy
 * can keep Q proposals out) and the reference hierarchy below a declared
 * node. Nothing here can reach a memory, a conversation, a document, an
 * evidence passage, a research finding or an onboarding answer.
 */

export type DomainFeaturePortDependencies = {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly taxonomy: TaxonomyQueryPort;
};

export type DomainFeaturePorts = {
  readonly companies: CompanyFeatureProjectionPort;
  readonly hierarchy: PreferenceHierarchyPort;
};

export function createDomainFeaturePorts(
  dependencies: DomainFeaturePortDependencies,
): DomainFeaturePorts {
  const { sql, companies, assignments, taxonomy } = dependencies;
  return {
    companies: {
      projectMany: async (companyIds) => {
        if (companyIds.length === 0) return new Map();
        // One bounded, discoverable-only read for the whole pool.
        const profiles = await companies.listDiscoverableInvestmentProfiles({
          companyIds: companyIds.map((id) => CompanyIdSchema.parse(id)),
          limit: companyIds.length,
        });
        const entries = await Promise.all(
          profiles.map(async (profile) => {
            const rows = await assignments.listCurrent(
              sql,
              TenantIdSchema.parse(profile.tenantId),
              { subjectType: "COMPANY", subjectId: profile.id },
            );
            return [
              profile.id,
              {
                state: {
                  sourceClass: "CANONICAL_COMPANY_STATE" as const,
                  companyId: profile.id,
                  tenantId: profile.tenantId,
                  currentStageCode: profile.currentStageCode,
                  headquartersCountry: profile.headquartersCountry,
                  version: profile.version,
                },
                taxonomy: {
                  sourceClass: "CANONICAL_TAXONOMY" as const,
                  classifications: rows.map((r) => ({
                    nodeId: r.nodeId,
                    vocabularyCode: r.vocabularyCode,
                    source: r.assignmentSource,
                  })),
                },
              },
            ] as const;
          }),
        );
        return new Map(entries);
      },
    },
    hierarchy: {
      expand: async (nodeIds) => {
        const unique = [...new Set(nodeIds)].sort();
        const nodes = await Promise.all(
          unique.map(async (nodeId) => {
            const node = await taxonomy.findNodeById(
              TaxonomyNodeIdSchema.parse(nodeId),
            );
            if (node === null) return [];
            const unrestricted =
              node.vocabularyCode === GEOGRAPHY_VOCABULARY &&
              node.canonicalCode === UNRESTRICTED_GEOGRAPHY_CODE;
            const descendants = unrestricted
              ? []
              : await taxonomy.listDescendants(node.id);
            return [
              {
                preferredNodeId: node.id,
                vocabularyCode: node.vocabularyCode,
                unrestricted,
                descendantNodeIds: descendants.map((d) => d.id).sort(),
              },
            ];
          }),
        );
        return {
          sourceClass: "TAXONOMY_REFERENCE_HIERARCHY",
          nodes: nodes.flat(),
        };
      },
    },
  };
}
