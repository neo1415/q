import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DISCOVERY_EXPLANATION_PATH,
  RecommendationExplanationDtoSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { RecommendationExplanationService } from "@capital-q/discovery";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * "Why am I seeing this?" (CQ-REC-007 D; doc 19 §57, §188).
 *
 * The route is thin on purpose. It resolves the actor, hands two
 * identifiers to the recommendation context and maps the answer; every
 * rule about who may read a slate, which ranking explains it and what a
 * reader may be told belongs to that context, not here.
 *
 * Neither identifier is authority. A slate the actor's investor
 * organisation does not own, a company that is not in it, and a slate that
 * never existed are one answer — 404 — so a probe learns nothing from the
 * difference. Nothing internal reaches the DTO: the internal score, the
 * weights, the similarity and the feature snapshot stay in the store.
 */

export type RecommendationExplanationRoutesDependencies =
  ActorContextDependencies & {
    readonly explanations: RecommendationExplanationService;
  };

type Params = {
  readonly slateId?: string | undefined;
  readonly companyId?: string | undefined;
};

export function registerRecommendationExplanationRoutes(
  app: FastifyInstance,
  dependencies: RecommendationExplanationRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(
    DISCOVERY_EXPLANATION_PATH,
    { onRequest: withContext },
    async (request: FastifyRequest, reply) => {
      const params = request.params as Params;
      const slateId = UuidSchema.safeParse(params.slateId);
      const companyId = UuidSchema.safeParse(params.companyId);
      // A malformed id is not a missing resource, but it must not be a
      // different answer either: it names nothing, exactly as an unknown
      // id does.
      if (!slateId.success || !companyId.success) {
        return reply.callNotFound();
      }

      const result = await dependencies.explanations.explain({
        actor: getActorContext(request),
        slateId: slateId.data,
        companyId: companyId.data,
        correlationId: createCorrelationId(),
      });

      void reply.header("Cache-Control", "no-store");
      if (result.kind === "REFUSED") {
        // Every refusal is the same 404. SNAPSHOT_UNAVAILABLE and
        // RANKING_VERSION_UNAVAILABLE are real distinctions for an
        // operator — they are in the metrics — but telling a caller which
        // one applies would confirm that the slate exists.
        return reply.callNotFound();
      }

      const e = result.explanation;
      return RecommendationExplanationDtoSchema.parse({
        slateId: e.slateId,
        companyId: e.companyId,
        rank: e.rank,
        summary: e.summary,
        matchedFactors: e.matchedFactors,
        mismatchedFactors: e.mismatchedFactors,
        uncertainties: e.uncertainties,
        generatedFromRankingVersion: e.generatedFromRankingVersion,
        source: e.source,
      });
    },
  );
}
