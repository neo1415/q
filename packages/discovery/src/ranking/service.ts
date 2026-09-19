import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { FEATURE_SCHEMA_VERSION } from "../features/contracts.js";
import type {
  FeatureComputationDiagnostics,
  FeatureService,
} from "../features/service.js";
import type { HybridCandidate } from "../hybrid/contracts.js";
import type { RankedCandidate } from "./contracts.js";
import type { Ranker } from "./ranker.js";

/**
 * The batch ranking service (CQ-REC-005 §85): one call ranks a whole pool.
 *
 *   ELIGIBLE hybrid candidates
 *   → REC-004 feature snapshots (the only input surface; current by
 *     construction: computed now, reused only on an identical fingerprint)
 *   → the deterministic ranker bound to one server-chosen config
 *   → RankedCandidate[] in memory (REC-006 persists slates)
 *
 * The caller names an actor, a mode, optionally its own mandate and the
 * pool. It cannot name a config, a weight, a score or a feature: those
 * are fixed by composition. The ranker itself performs no read.
 */

export type RankCandidatesQuery = {
  readonly actor: ActorContext;
  readonly mode: "INVESTOR_DISCOVER";
  readonly mandateId?: string | null | undefined;
  readonly candidates: readonly HybridCandidate[];
};

export type RankingRunDiagnostics = {
  readonly rankerId: string;
  readonly rankerVersion: string;
  readonly rankingConfigVersion: string;
  readonly featureSchemaVersion: typeof FEATURE_SCHEMA_VERSION;
  readonly candidates: number;
  readonly scored: number;
  readonly unscored: number;
  readonly factorsMissing: number;
  readonly rankDurationMs: number;
  readonly features: FeatureComputationDiagnostics;
};

export type RankCandidatesResult =
  | {
      readonly kind: "RANKED";
      readonly ranked: readonly RankedCandidate[];
      readonly diagnostics: RankingRunDiagnostics;
    }
  | { readonly kind: "NO_ACTIVE_MANDATE" };

export type RankingService = {
  readonly rankCandidates: (
    query: RankCandidatesQuery,
  ) => Promise<RankCandidatesResult>;
};

export function createRankingService(dependencies: {
  readonly features: FeatureService;
  readonly ranker: Ranker;
  readonly logger?: Logger | undefined;
}): RankingService {
  const { features, ranker, logger } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.ranking.runs"),
    duration: meter.createHistogram("discovery.ranking.rank_duration_ms"),
    candidates: meter.createHistogram("discovery.ranking.candidates"),
    unscored: meter.createHistogram("discovery.ranking.unscored"),
    score: meter.createHistogram("discovery.ranking.internal_score"),
    factorsMissing: meter.createHistogram("discovery.ranking.factors_missing"),
  };

  return {
    rankCandidates: async (query) => {
      const computed = await features.computeForCandidates({
        actor: query.actor,
        mode: query.mode,
        mandateId: query.mandateId,
        candidates: query.candidates,
      });
      if (computed.kind === "NO_ACTIVE_MANDATE") return computed;
      const [first] = computed.snapshots;
      const started = performance.now();
      const ranked =
        first === undefined
          ? []
          : await ranker.rank(
              {
                recommendation: first.context,
                mandateVersion: first.mandateVersion,
              },
              computed.snapshots.map((snapshot) => ({
                companyId: snapshot.companyId,
                snapshot,
              })),
            );
      const rankDurationMs =
        Math.round((performance.now() - started) * 1000) / 1000;
      const scored = ranked.filter((r) => r.scored).length;
      const factorsMissing = ranked.reduce(
        (n, r) => n + r.diagnostics.missingFactorCount,
        0,
      );
      const labels = { ranker: ranker.version, config: ranker.configVersion };
      metrics.runs.add(1, labels);
      metrics.duration.record(rankDurationMs, labels);
      metrics.candidates.record(ranked.length, labels);
      metrics.unscored.record(ranked.length - scored, labels);
      metrics.factorsMissing.record(factorsMissing, labels);
      for (const r of ranked) {
        if (r.internalScore !== null)
          metrics.score.record(r.internalScore, labels);
      }
      const diagnostics: RankingRunDiagnostics = {
        rankerId: ranker.id,
        rankerVersion: ranker.version,
        rankingConfigVersion: ranker.configVersion,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        candidates: ranked.length,
        scored,
        unscored: ranked.length - scored,
        factorsMissing,
        rankDurationMs,
        features: computed.diagnostics,
      };
      // Counts and versions only.
      logger?.debug(
        {
          ...diagnostics,
          features: undefined,
          featureQueries: computed.diagnostics.queries,
        },
        "recommendation candidates ranked",
      );
      return { kind: "RANKED", ranked, diagnostics };
    },
  };
}
