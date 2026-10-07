import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyMarketplaceQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  CompanyQualificationProjection,
  CompanyQualificationProjectionPort,
} from "@capital-q/gateq";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
} from "@capital-q/taxonomy";

/**
 * The bounded company projection GateQ qualifies against (CQ-GATE-001
 * §12), composed for the Q API so Q's "which investors fit us?" checks a
 * founder's own company against published gates the same way the API's
 * route does. It mirrors `apps/api/src/gateq/company-projection.ts`: the
 * projection carries three declared facts and one declared raise, never a
 * document, a conversation or a Q inference, so founder-private material
 * has nowhere to enter. Keep the two in step.
 */
export function createQApiGateQCompanyProjectionPort(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly companies: CompanyMarketplaceQueryPort;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly reference: TaxonomyReferenceRepository;
  readonly capital: CapitalObjectiveQueryPort;
}): CompanyQualificationProjectionPort {
  const { sql, companies, assignments, reference, capital } = dependencies;
  return {
    projectionFor: async (query) => {
      const [company] = await companies.findCanonicalMarketplaceFacts([
        query.companyId as Parameters<
          CompanyMarketplaceQueryPort["findCanonicalMarketplaceFacts"]
        >[0][number],
      ]);
      if (company === undefined) return null;
      const current = await assignments.listCurrent(sql, company.tenantId, {
        subjectType: "COMPANY",
        subjectId: company.id,
      });
      const ancestorsByNode = new Map<string, readonly string[]>();
      await Promise.all(
        [...new Set(current.map((a) => a.nodeId))].map(async (nodeId) => {
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
        subject: {
          kind: "COMPANY",
          companyId: company.id,
          tenantId: company.tenantId,
        },
        classifications: current.map((assignment) => ({
          vocabularyCode: assignment.vocabularyCode,
          nodeId: assignment.nodeId,
          ancestorNodeIds: [...(ancestorsByNode.get(assignment.nodeId) ?? [])],
        })),
        headquartersCountry: company.headquartersCountry,
        currentStageCode: company.currentStageCode,
        // A closed objective is not a raise; null is unknown, never zero.
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
