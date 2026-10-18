import type { ActorContext } from "@capital-q/security";
import type { Logger } from "@capital-q/observability";

import type { EligibilityPorts } from "../eligibility/ports.js";
import type { SlateRepository } from "../slates/ports.js";

import type { ExplainResult } from "./contracts.js";
import type { RecommendationExplanationService } from "./service.js";

/**
 * "Why am I seeing this company?" asked without a slate id (CQ-REC-007R B).
 *
 * The HTTP endpoint is given the slate the surface was showing. A
 * conversation has no such thing: the person names a company, or names
 * nothing at all and means the one they are looking at. Something has to
 * turn that into a slate, and it must not be the model.
 *
 * So the slate is resolved here, from the actor alone. The caller supplies
 * a company id and never a slate id, which is the whole point: a model
 * that invented a slate id would be inventing authority, and there is no
 * field for it to put one in. The actor's own investor organisation is
 * read from the subject port, its CURRENT slates are listed, and the first
 * one that actually contains the company wins. Everything after that is
 * REC-007 B's service unchanged -- same snapshot, same fingerprint check,
 * same ranking config, same refusals -- because a second way of deciding
 * why something was ranked would be a second ranker.
 *
 * A company in no current slate is NOT_FOUND, not an explanation with a
 * caveat. Capital Q did not recommend it, so there is nothing to explain.
 */

export type ExplainCurrentRecommendationQuery = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly correlationId?: string | undefined;
};

export type CurrentSlateExplanationService = {
  readonly explainCurrent: (
    query: ExplainCurrentRecommendationQuery,
  ) => Promise<ExplainResult>;
};

export type CurrentSlateExplanationDependencies = {
  readonly ports: Pick<EligibilityPorts, "investorSubject">;
  readonly slates: SlateRepository;
  readonly explanations: RecommendationExplanationService;
  readonly logger?: Logger | undefined;
};

export function createCurrentSlateExplanationService(
  dependencies: CurrentSlateExplanationDependencies,
): CurrentSlateExplanationService {
  const { ports, slates, explanations, logger } = dependencies;

  return {
    explainCurrent: async (query) => {
      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        // Not an investor, so no slate of theirs exists to explain.
        return { kind: "REFUSED", refusal: "NOT_FOUND" };
      }
      const current = await slates.findCurrentForInvestor({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
      });
      for (const slate of current) {
        const item = await slates.findItem(slate.id, query.companyId);
        if (item === null) continue;
        return explanations.explain({
          actor: query.actor,
          slateId: slate.id,
          companyId: query.companyId,
          ...(query.correlationId === undefined
            ? {}
            : { correlationId: query.correlationId }),
        });
      }
      logger?.debug(
        { slatesSearched: current.length },
        "no current slate contains the company an explanation was asked for",
      );
      return { kind: "REFUSED", refusal: "NOT_FOUND" };
    },
  };
}
