import {
  CompanyIdSchema,
  type CompanyMarketplaceQueryPort,
} from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  TaxonomyNodeIdSchema,
  type TaxonomyAssignmentRepository,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import type { StructuredRetrievalPorts } from "../candidates/ports.js";
import { createNotComputableChequeRetrieval } from "../candidates/ports.js";
import {
  GEOGRAPHY_VOCABULARY,
  UNRESTRICTED_GEOGRAPHY_CODE,
} from "../candidates/structured.js";
import { DECLARED_TAXONOMY_SOURCES } from "../eligibility/policy.js";

/**
 * Structured retrieval, assembled from the owning contexts' public ports.
 * No SQL here: Companies answers which discovery-classified companies
 * carry a stage or a country, Taxonomy answers which companies carry a
 * node and what lies below a declared node in the reference hierarchy.
 * The cheque seam is the V1 "not computable" implementation because no
 * discovery-safe raise projection exists yet.
 */

export type DomainCandidatePortDependencies = {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly taxonomy: TaxonomyQueryPort;
};

export function createDomainCandidatePorts(
  dependencies: DomainCandidatePortDependencies,
): StructuredRetrievalPorts {
  const { sql, companies, assignments, taxonomy } = dependencies;
  const refs = (
    rows: readonly { id: string; tenantId: string; organisationId: string }[],
  ) =>
    rows.map((row) => ({
      companyId: row.id,
      tenantId: row.tenantId,
      organisationId: row.organisationId,
    }));

  return {
    companies: {
      byStageCodes: async (stageCodes, limit) =>
        refs(
          await companies.listDiscoverableCompanies({
            stageCodes,
            headquartersCountries: null,
            limit,
          }),
        ),
      byHeadquartersCountries: async (countryCodes, limit) =>
        refs(
          await companies.listDiscoverableCompanies({
            stageCodes: null,
            headquartersCountries: countryCodes,
            limit,
          }),
        ),
    },
    taxonomy: {
      subjectsByNodes: async (nodeIds, limit) => {
        // Declared classifications only (structured-mandate.v2): a Q
        // inference or an extracted suggestion is not what the company
        // is, until a person confirms it (ADR 0006 point 5).
        const rows = await assignments.listCurrentByNodes(
          sql,
          "COMPANY",
          nodeIds.map((id) => TaxonomyNodeIdSchema.parse(id)),
          limit,
          DECLARED_TAXONOMY_SOURCES,
        );
        if (rows.length === 0) return [];
        // A classification is not a discovery projection: intersect with
        // the Companies context's discoverable facts so a private or closed
        // company never enters the pool, not even as an id. REC-001 would
        // stop it anyway; this keeps retrieval on the visible projection.
        const ids = [...new Set(rows.map((row) => row.subjectId))].map((id) =>
          CompanyIdSchema.parse(id),
        );
        const facts = await companies.findCanonicalMarketplaceFacts(ids);
        const discoverable = new Set(
          facts
            .filter(
              (f) =>
                f.companyStatus === "active" &&
                (f.marketplaceVisibility === "network_visible" ||
                  f.marketplaceVisibility === "public_external"),
            )
            .map((f) => f.id as string),
        );
        return rows
          .filter((row) => discoverable.has(row.subjectId))
          .map((row) => ({
            companyId: row.subjectId,
            tenantId: row.tenantId,
            nodeId: row.nodeId,
            vocabularyCode: row.vocabularyCode,
          }));
      },
      expandPreference: async (nodeId) => {
        const node = await taxonomy.findNodeById(
          TaxonomyNodeIdSchema.parse(nodeId),
        );
        if (node === null) return null;
        const unrestricted =
          node.vocabularyCode === GEOGRAPHY_VOCABULARY &&
          node.canonicalCode === UNRESTRICTED_GEOGRAPHY_CODE;
        const descendants = unrestricted
          ? []
          : await taxonomy.listDescendants(node.id);
        return {
          preferredNodeId: node.id,
          vocabularyCode: node.vocabularyCode,
          unrestricted,
          descendantNodeIds: descendants.map((d) => d.id).sort(),
        };
      },
    },
    cheque: createNotComputableChequeRetrieval(),
  };
}
