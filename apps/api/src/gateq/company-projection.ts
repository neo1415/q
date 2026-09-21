import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyMarketplaceQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  CompanyQualificationProjection,
  CompanyQualificationProjectionPort,
  InvestorOrganisationDisplayPort,
} from "@capital-q/gateq";
import {
  InvestorOrganisationIdSchema,
  type InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
} from "@capital-q/taxonomy";

/**
 * Building the bounded company projection GateQ qualifies against
 * (CQ-GATE-001 §12).
 *
 * This lives in the API's composition layer rather than in
 * `@capital-q/gateq` on purpose. GateQ owns gateways and nothing else, so
 * it must not import Companies, Taxonomy or Capital; the app is where
 * contexts are wired together, and the projection port is the seam.
 *
 * What the projection contains is the whole security argument. Three
 * declared facts and one declared raise — no document, no conversation, no
 * Q inference, no data-room object, no evidence. Derived intelligence
 * inherits the sensitivity of its source, so the way to keep founder-
 * private material out of an inbound decision is to keep it out of the
 * input, and the type has nowhere to put it.
 *
 * Reads are bounded and fixed: the company's facts, its current
 * classifications, the ancestors of each assigned node, and its open
 * capital objective. Ancestors are what lets an investor who said
 * "fintech" match a company classified "payments" — the canonical
 * hierarchy's answer rather than a string comparison's.
 */
export function createGateQCompanyProjectionPort(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly reference: TaxonomyReferenceRepository;
  readonly capital: CapitalObjectiveQueryPort;
}): CompanyQualificationProjectionPort {
  const { sql, companies, assignments, reference, capital } = dependencies;

  return {
    projectionFor: async (query: {
      readonly tenantId: string;
      readonly companyId: string;
    }) => {
      const facts = await companies.findCanonicalMarketplaceFacts([
        query.companyId as Parameters<
          CompanyMarketplaceQueryPort["findCanonicalMarketplaceFacts"]
        >[0][number],
      ]);
      const company = facts[0];
      if (company === undefined) return null;

      const current = await assignments.listCurrent(sql, company.tenantId, {
        subjectType: "COMPANY",
        subjectId: company.id,
      });
      // One ancestor read per distinct assigned node, and a company carries
      // a handful. Bounded by the classification set, not by the pool.
      const distinct = [...new Set(current.map((a) => a.nodeId))];
      const ancestorsByNode = new Map<string, readonly string[]>();
      await Promise.all(
        distinct.map(async (nodeId) => {
          const ancestors = await reference.listAncestors(sql, nodeId);
          ancestorsByNode.set(
            nodeId,
            ancestors.map((node) => node.id).slice(0, 16),
          );
        }),
      );

      const objective = await capital.getCurrentForCompany(
        company.tenantId,
        company.id,
      );

      const projection: CompanyQualificationProjection = {
        companyId: company.id,
        tenantId: company.tenantId,
        classifications: current.map((assignment) => ({
          vocabularyCode: assignment.vocabularyCode,
          nodeId: assignment.nodeId,
          ancestorNodeIds: [...(ancestorsByNode.get(assignment.nodeId) ?? [])],
        })),
        headquartersCountry: company.headquartersCountry,
        currentStageCode: company.currentStageCode,
        // A closed objective is not a raise. Null means nobody has said,
        // and GateQ reads that as UNKNOWN rather than as zero.
        raise:
          objective === null || objective.status !== "ACTIVE"
            ? null
            : {
                amount: objective.target.amount,
                currency: objective.target.currency,
              },
      };
      return projection;
    },
  };
}

/** The owning organisation's display identity, for the public projection. */
export function createGateQOrganisationDisplayPort(dependencies: {
  readonly investors: InvestorOrganisationQueryPort;
}): InvestorOrganisationDisplayPort {
  const { investors } = dependencies;
  return {
    displayNameFor: async (query: {
      readonly tenantId: string;
      readonly investorOrganisationId: string;
    }) => {
      const investor = await investors.getCanonicalInvestorOrganisation(
        TenantIdSchema.parse(query.tenantId),
        InvestorOrganisationIdSchema.parse(query.investorOrganisationId),
      );
      return investor === null ? null : investor.displayName;
    },
  };
}
