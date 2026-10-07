import {
  InvestorGateFitDtoSchema,
  type GateCriterionStanding,
  type InvestorGateFitDto,
} from "@capital-q/contracts";

import type { CriterionStatus } from "../contracts/index.js";
import { qualify } from "../domain/qualification.js";
import type {
  CompanyQualificationProjectionPort,
  GatewayPolicyPort,
} from "./ports.js";

/**
 * Q.05 "Finds the right investors" (2026-10-07): for a founder, which
 * investors publish a gate and how the founder's OWN company stands on
 * each published criterion.
 *
 * It reads only published gates (public by design, §19) and runs the same
 * deterministic qualification an application runs, against the company
 * projection the caller is entitled to (their own company, in their own
 * tenant; anything else projects to nothing and returns nothing). What
 * leaves is the gate's public face plus met / not met / not known yet per
 * criterion, by the investor's own label: never a configured threshold,
 * never a mandate, never a score. Unknown stays unknown and is not a no.
 */

const STANDING: Readonly<Record<CriterionStatus, GateCriterionStanding>> = {
  MATCH: "MET",
  NO_MATCH: "NOT_MET",
  UNKNOWN: "UNKNOWN",
};

export type InvestorGateFits = {
  readonly forOwnCompany: (query: {
    /** The founder's own tenant (the actor's), never the client's word. */
    readonly tenantId: string;
    /** The founder's own company, resolved by the server. */
    readonly companyId: string;
    readonly investorOrganisationIds: readonly string[];
  }) => Promise<readonly InvestorGateFitDto[]>;
};

export function createInvestorGateFits(dependencies: {
  readonly policies: GatewayPolicyPort;
  readonly companies: CompanyQualificationProjectionPort;
  readonly clock?: (() => Date) | undefined;
}): InvestorGateFits {
  const clock = dependencies.clock ?? (() => new Date());
  return {
    forOwnCompany: async (query) => {
      const read = dependencies.policies.publishedPoliciesForInvestorOrganisations;
      const ids = [...new Set(query.investorOrganisationIds)].slice(0, 50);
      if (read === undefined || ids.length === 0) return [];
      const [policies, projection] = await Promise.all([
        read(ids),
        dependencies.companies.projectionFor({
          tenantId: query.tenantId,
          companyId: query.companyId,
        }),
      ]);
      // The founder's own tenant only: a projection port that reads by
      // company id alone must still never answer for another tenant.
      if (projection === null || projection.subject.tenantId !== query.tenantId) {
        return [];
      }
      const evaluatedAt = clock().toISOString();
      // One gate per organisation: the newest published one.
      const seen = new Set<string>();
      const out: InvestorGateFitDto[] = [];
      for (const policy of policies) {
        const organisation = policy.gateway.investorOrganisationId;
        if (seen.has(organisation) || !ids.includes(organisation)) continue;
        if (policy.gateway.status !== "ACTIVE") continue;
        if (policy.version.status !== "PUBLISHED") continue;
        seen.add(organisation);
        const result = qualify({ policy, projection, evaluatedAt });
        const byId = new Map(result.criteria.map((c) => [c.criterionId, c]));
        out.push(
          InvestorGateFitDtoSchema.parse({
            investorOrganisationId: organisation,
            publicId: policy.gateway.publicId,
            title: policy.version.publicTitle,
            acceptingApplications: policy.version.inboundMode !== "CLOSED",
            criteria: [...policy.criteria]
              .sort((a, b) => a.position - b.position)
              .map((criterion) => ({
                label: criterion.label,
                requiredness: criterion.requiredness,
                dimension: criterion.config.type,
                standing: STANDING[byId.get(criterion.id)?.status ?? "UNKNOWN"],
              })),
          }),
        );
      }
      return out;
    },
  };
}
