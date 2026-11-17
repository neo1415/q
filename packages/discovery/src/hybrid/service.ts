import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  CANDIDATE_POOL_MAX,
  STRUCTURED_GENERATOR_VERSION,
} from "../candidates/contracts.js";
import type { StructuredCandidateService } from "../candidates/service.js";
import { ELIGIBILITY_POLICY_VERSION } from "../eligibility/contracts.js";
import { SEMANTIC_GENERATOR_VERSION } from "../semantic/contracts.js";
import type { SemanticCandidateService } from "../semantic/service.js";
import {
  HYBRID_POOL_VERSION,
  type HybridCandidate,
  type HybridCandidatePool,
} from "./contracts.js";
import { mergeCandidatePools } from "./merge.js";

/**
 * Runs both V1 generators for the same actor and mandate and merges their
 * pools. The structured generator is authoritative for the "no active
 * mandate" answer (both read the same port, so they agree); the semantic
 * generator may degrade to UNAVAILABLE, in which case the pool is the
 * structured pool and the result says so. A semantic failure can never
 * corrupt, reorder or remove a structured candidate.
 */

export type GenerateHybridCandidatesQuery = {
  readonly actor: ActorContext;
  readonly mandateId?: string | null | undefined;
  readonly limit?: number | undefined;
  readonly topK?: number | undefined;
  /** The structured rotation's window (candidates/window.ts); absent: the first. */
  readonly window?: number | undefined;
};

export type HybridCandidateService = {
  readonly generate: (
    query: GenerateHybridCandidatesQuery,
  ) => Promise<HybridCandidatePool>;
};

export type HybridCandidateServiceDependencies = {
  readonly structured: StructuredCandidateService;
  readonly semantic: SemanticCandidateService;
  readonly logger?: Logger | undefined;
};

export function createHybridCandidateService(
  dependencies: HybridCandidateServiceDependencies,
): HybridCandidateService {
  const { structured, semantic, logger } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.candidates.hybrid.runs"),
    merged: meter.createHistogram("discovery.candidates.hybrid.merged"),
    degraded: meter.createCounter(
      "discovery.candidates.hybrid.semantic_unavailable",
    ),
    scored: meter.createHistogram(
      "discovery.candidates.hybrid.similarity_scored",
    ),
  };

  /**
   * Live 17 Nov 2026 (Zino): a structured-only candidate carried no mandate
   * similarity, so its THESIS read unknown although both vectors existed.
   * Every admitted candidate the semantic generator did not retrieve gets
   * the same cosine computed directly, in one bounded read; top-K stays a
   * candidate generator only. A failure here changes nothing else: the
   * similarity stays unknown and the pool is exactly as merged.
   */
  async function withMandateSimilarity(
    merged: readonly HybridCandidate[],
    query: GenerateHybridCandidatesQuery,
    mandateId: string | null,
  ): Promise<HybridCandidate[]> {
    const unscored = merged.filter(
      (one) => one.semantic === null && one.eligibility.decision === "ELIGIBLE",
    );
    if (
      unscored.length === 0 ||
      mandateId === null ||
      semantic.scoreCompanies === undefined
    ) {
      return [...merged];
    }
    const scored = await semantic
      .scoreCompanies({
        actor: query.actor,
        mandateId,
        companyIds: unscored.map((one) => one.companyId),
      })
      .catch((error: unknown) => {
        logger?.warn(
          {
            poolVersion: HYBRID_POOL_VERSION,
            error: error instanceof Error ? error.name : "UNKNOWN",
          },
          "mandate similarity for structured candidates not computed",
        );
        return null;
      });
    if (scored?.kind !== "SCORED" || scored.mandateId !== mandateId) {
      return [...merged];
    }
    metrics.scored.record(scored.similarities.size, {
      pool: HYBRID_POOL_VERSION,
    });
    return merged.map((one) => {
      if (one.semantic !== null) return one;
      const similarity = scored.similarities.get(one.companyId.toLowerCase());
      return similarity === undefined
        ? one
        : { ...one, mandateSimilarity: similarity };
    });
  }

  return {
    generate: async (query) => {
      const started = performance.now();
      const poolMax = Math.max(
        1,
        Math.min(
          CANDIDATE_POOL_MAX,
          Math.trunc(query.limit ?? CANDIDATE_POOL_MAX),
        ),
      );
      const [structuredResult, semanticResult] = await Promise.all([
        structured.generate({
          actor: query.actor,
          mandateId: query.mandateId,
          limit: poolMax,
          ...(query.window === undefined ? {} : { window: query.window }),
        }),
        semantic.generate({
          actor: query.actor,
          mandateId: query.mandateId,
          topK: query.topK,
        }),
      ]);

      if (structuredResult.kind === "NO_ACTIVE_MANDATE") {
        return {
          kind: "NO_ACTIVE_MANDATE",
          poolVersion: HYBRID_POOL_VERSION,
          context: structuredResult.context,
        };
      }

      const semanticCandidates =
        semanticResult.kind === "GENERATED" ? semanticResult.candidates : [];
      const merged = mergeCandidatePools({
        structured: structuredResult.candidates,
        semantic: semanticCandidates,
        poolMax,
      });
      const candidates = await withMandateSimilarity(
        merged.candidates,
        query,
        structuredResult.context.mandateId,
      );
      const semanticUnavailable =
        semanticResult.kind === "UNAVAILABLE"
          ? {
              failureClass: semanticResult.failureClass,
              retryable: semanticResult.retryable,
            }
          : null;
      const durationMs = Math.round(performance.now() - started);

      metrics.runs.add(1, { pool: HYBRID_POOL_VERSION });
      metrics.merged.record(merged.candidates.length, {
        pool: HYBRID_POOL_VERSION,
      });
      if (semanticUnavailable !== null) {
        metrics.degraded.add(1, { pool: HYBRID_POOL_VERSION });
      }
      logger?.debug(
        {
          poolVersion: HYBRID_POOL_VERSION,
          merged: merged.candidates.length,
          structuredOnly: merged.structuredOnly,
          semanticOnly: merged.semanticOnly,
          both: merged.both,
          truncated: merged.truncated,
          semanticUnavailable,
          durationMs,
        },
        "hybrid candidate pool generated",
      );

      return {
        kind: "GENERATED",
        poolVersion: HYBRID_POOL_VERSION,
        structuredGeneratorVersion: STRUCTURED_GENERATOR_VERSION,
        semanticGeneratorVersion: SEMANTIC_GENERATOR_VERSION,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
        context: structuredResult.context,
        semanticUnavailable,
        candidates,
        diagnostics: {
          structured: structuredResult.diagnostics,
          semantic:
            semanticResult.kind === "GENERATED"
              ? semanticResult.diagnostics
              : null,
          merged: merged.candidates.length,
          structuredOnly: merged.structuredOnly,
          semanticOnly: merged.semanticOnly,
          both: merged.both,
          durationMs,
        },
      };
    },
  };
}
