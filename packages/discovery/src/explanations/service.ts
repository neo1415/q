import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityPorts } from "../eligibility/ports.js";
import type { RecommendationFeatureSnapshot } from "../features/contracts.js";
import { RANKING_CONFIGS, type RankingConfig } from "../ranking/config.js";
import { scoreSnapshot } from "../ranking/ranker.js";
import type { SlateRepository } from "../slates/ports.js";
import {
  EXPLANATION_VERSION,
  RecommendationExplanationSchema,
  type ExplainResult,
} from "./contracts.js";
import {
  deterministicSummary,
  rankingVersionLabel,
  toExplanationFactors,
} from "./policy.js";

/**
 * The recommendation explanation service (doc 19 §250's
 * `RecommendationExplanationService`; §58, §189).
 *
 *   item → its own feature snapshot → the ranking config the SLATE
 *   recorded → the same factor results the ranker produced → three
 *   buckets and a sentence
 *
 * Two properties make this an explanation rather than a story. First, the
 * factors are replayed, not recomputed from today's world: the snapshot is
 * fetched by the id the item stored and refused if its fingerprint has
 * moved, and the config is looked up by the slate's own version, so an old
 * recommendation is explained by the ranking that produced it or not at
 * all. Second, the replay is `scoreSnapshot` — the same pure function the
 * ranker used — so there is no second implementation that could drift.
 *
 * Authority is resolved here and never taken from the request: a slate id
 * names nothing until the actor's own investor organisation is shown to
 * own it, and a slate belonging to somebody else is reported exactly as a
 * slate that does not exist.
 */

export type ExplanationSnapshotPort = {
  /** The exact snapshot an item was ranked from, by id. Null when it is gone. */
  readonly byId: (
    snapshotId: string,
  ) => Promise<RecommendationFeatureSnapshot | null>;
};

export type ExplainRecommendationQuery = {
  readonly actor: ActorContext;
  readonly slateId: string;
  readonly companyId: string;
};

export type RecommendationExplanationService = {
  readonly explain: (
    query: ExplainRecommendationQuery,
  ) => Promise<ExplainResult>;
};

export type RecommendationExplanationDependencies = {
  readonly ports: Pick<EligibilityPorts, "investorSubject">;
  readonly slates: SlateRepository;
  readonly snapshots: ExplanationSnapshotPort;
  /** The configs this build carries; a slate naming another is refused. */
  readonly configs?: readonly RankingConfig[] | undefined;
  readonly logger?: Logger | undefined;
};

export function createRecommendationExplanationService(
  dependencies: RecommendationExplanationDependencies,
): RecommendationExplanationService {
  const { ports, slates, snapshots, logger } = dependencies;
  const configs = dependencies.configs ?? RANKING_CONFIGS;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    explained: meter.createCounter("discovery.explanations.produced"),
    refused: meter.createCounter("discovery.explanations.refused"),
  };

  return {
    explain: async (query) => {
      const no = (
        reason:
          "NOT_FOUND" | "SNAPSHOT_UNAVAILABLE" | "RANKING_VERSION_UNAVAILABLE",
      ): ExplainResult => {
        metrics.refused.add(1, { refusal: reason });
        return { kind: "REFUSED", refusal: reason };
      };

      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) return no("NOT_FOUND");

      const slate = await slates.findById(query.slateId);
      // Somebody else's slate and a slate that never existed are the same
      // answer: a recommendation id is a selection, never authority.
      if (
        slate === null ||
        slate.tenantId !== query.actor.tenantId ||
        slate.investorOrganisationId !== subject.investorOrganisationId
      ) {
        return no("NOT_FOUND");
      }

      const item = await slates.findItem(query.slateId, query.companyId);
      if (item === null) return no("NOT_FOUND");

      const snapshot = await snapshots.byId(item.featureSnapshotId);
      if (snapshot === null) return no("SNAPSHOT_UNAVAILABLE");
      if (snapshot.fingerprint !== item.featureSnapshotFingerprint) {
        // The row moved under the slate. Explaining from it would describe
        // inputs the ranker never saw.
        return no("SNAPSHOT_UNAVAILABLE");
      }

      const config = configs.find(
        (candidate) => candidate.version === slate.rankingConfigVersion,
      );
      if (config === undefined) return no("RANKING_VERSION_UNAVAILABLE");

      // The same pure scoring the ranker ran, over the same snapshot, under
      // the version the slate recorded. Its score is discarded here: only
      // the factor outcomes are anybody's business.
      const { factors } = scoreSnapshot(config, snapshot);
      const buckets = toExplanationFactors(factors);

      const explanation = RecommendationExplanationSchema.parse({
        explanationVersion: EXPLANATION_VERSION,
        slateId: slate.id,
        companyId: item.companyId,
        rank: item.rank,
        summary: deterministicSummary(buckets),
        matchedFactors: buckets.matchedFactors,
        mismatchedFactors: buckets.mismatchedFactors,
        uncertainties: buckets.uncertainties,
        generatedFromRankingVersion: rankingVersionLabel({
          rankerVersion: slate.rankerVersion,
          rankingConfigVersion: slate.rankingConfigVersion,
        }),
        source: "DETERMINISTIC",
      });

      metrics.explained.add(1, { source: "DETERMINISTIC" });
      // Counts and versions only: no label, no summary, no company name.
      logger?.debug(
        {
          slateId: slate.id,
          rank: item.rank,
          matched: buckets.matchedFactors.length,
          mismatched: buckets.mismatchedFactors.length,
          uncertain: buckets.uncertainties.length,
          rankingConfigVersion: slate.rankingConfigVersion,
        },
        "recommendation explanation produced",
      );
      return { kind: "EXPLAINED", explanation };
    },
  };
}
