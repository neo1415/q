import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityPorts } from "../eligibility/ports.js";
import type { RecommendationFeatureSnapshot } from "../features/contracts.js";
import { RANKING_CONFIGS, type RankingConfig } from "../ranking/config.js";
import { scoreSnapshot } from "../ranking/ranker.js";
import type { CompanyCardPort, SlateRepository } from "../slates/ports.js";
import {
  EXPLANATION_VERSION,
  RecommendationExplanationSchema,
  type ExplainResult,
  type ExplanationFactor,
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

/**
 * Q's phrasing layer, behind a port (doc 19 §58–§59). Discovery states the
 * facts; something above it may say them better. The port returns a
 * summary or nothing, never an error — because an explanation that depends
 * on a model being reachable is not an explanation.
 */
export type ExplanationNarrator = {
  readonly narrate: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
    readonly companyDescription: string;
    readonly investorDescription: string;
    readonly matchedFactors: readonly ExplanationFactor[];
    readonly mismatchedFactors: readonly ExplanationFactor[];
    readonly uncertainties: readonly ExplanationFactor[];
  }) => Promise<
    | { readonly kind: "NARRATED"; readonly summary: string }
    | { readonly kind: "UNAVAILABLE" }
  >;
};

export type ExplainRecommendationQuery = {
  readonly actor: ActorContext;
  readonly slateId: string;
  readonly companyId: string;
  /** Ties a narration call to the request that asked for it. */
  readonly correlationId?: string | undefined;
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
  /** Declared company cards, for the one line a narration may quote. */
  readonly cards?: CompanyCardPort | undefined;
  /** Absent means every explanation is the deterministic one. */
  readonly narrator?: ExplanationNarrator | undefined;
  /** The configs this build carries; a slate naming another is refused. */
  readonly configs?: readonly RankingConfig[] | undefined;
  readonly logger?: Logger | undefined;
};

export function createRecommendationExplanationService(
  dependencies: RecommendationExplanationDependencies,
): RecommendationExplanationService {
  const { ports, slates, snapshots, cards, narrator, logger } = dependencies;
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

      // Q may phrase the same facts more naturally. It is asked only after
      // the deterministic explanation exists, it is given the bounded
      // factor labels and one declared line about the company, and its
      // answer is used only if it comes back. Nothing below can change a
      // factor: the arrays are already fixed.
      let summary = deterministicSummary(buckets);
      let source: "DETERMINISTIC" | "Q_SYNTHESIZED" = "DETERMINISTIC";
      if (narrator !== undefined) {
        const card = await cards?.cardsByIds([item.companyId]);
        const narration = await narrator.narrate({
          tenantId: query.actor.tenantId,
          userId: query.actor.userId,
          correlationId: query.correlationId ?? `cor_${slate.id}`,
          companyDescription: card?.get(item.companyId)?.shortDescription ?? "",
          investorDescription:
            "the criteria this investor's own mandate declares",
          matchedFactors: buckets.matchedFactors,
          mismatchedFactors: buckets.mismatchedFactors,
          uncertainties: buckets.uncertainties,
        });
        if (narration.kind === "NARRATED") {
          summary = narration.summary;
          source = "Q_SYNTHESIZED";
        }
      }

      const explanation = RecommendationExplanationSchema.parse({
        explanationVersion: EXPLANATION_VERSION,
        slateId: slate.id,
        companyId: item.companyId,
        rank: item.rank,
        summary,
        matchedFactors: buckets.matchedFactors,
        mismatchedFactors: buckets.mismatchedFactors,
        uncertainties: buckets.uncertainties,
        generatedFromRankingVersion: rankingVersionLabel({
          rankerVersion: slate.rankerVersion,
          rankingConfigVersion: slate.rankingConfigVersion,
        }),
        source,
      });

      metrics.explained.add(1, { source });
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
