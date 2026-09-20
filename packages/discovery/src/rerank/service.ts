import { createHash } from "node:crypto";

import { getMeter, type Logger } from "@capital-q/observability";

import type { HybridCandidate } from "../hybrid/contracts.js";
import {
  PassReintroductionReasonSchema,
  type PassReintroductionReason,
} from "./policy.js";
import type { PassReintroductionPort, RerankSignalsPort } from "./ports.js";
import type { RerankFacts } from "./contracts.js";
import type {
  BaseRankedCandidate,
  Reranker,
  RerankResult,
} from "./reranker.js";

/**
 * The rerank service (CQ-REC-009): the one place that turns a pipeline run
 * into the facts the pure reranker reorders by.
 *
 * It reads exactly two things — this organisation's bounded interaction
 * signals, and whether any passed company has a proven reason to come back
 * — and derives one more from the pool it was already given. Nothing else
 * is fetched, so there is no N+1 to find: one batched read per build,
 * whatever the pool size.
 */

/**
 * Which of the investor's own declared taxonomy preferences a company
 * matched, as one comparable key.
 *
 * `preferredNodeId` is the mandate's node, not the company's: two
 * companies share a cluster when they answer the same declared preference,
 * which is the granularity doc 19 §81 is about — a page of twelve
 * companies that are all the investor's one stated interest. The ids are
 * hashed because the key is only ever compared for equality, and an opaque
 * one cannot leak a mandate's taxonomy into a diagnostic or a log line.
 *
 * Null for a company the structured generator did not find. Unknown stays
 * unknown: it is never treated as a cluster of its own, never capped and
 * never counted against anything.
 */
export function clusterKeyFor(candidate: HybridCandidate): string | null {
  const nodes = candidate.structured?.matchedNodes ?? [];
  if (nodes.length === 0) return null;
  const preferred = [...new Set(nodes.map((n) => n.preferredNodeId))].sort();
  return createHash("sha256").update(preferred.join(",")).digest("hex");
}

export type RerankPoolQuery = {
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
  readonly mandateVersion: number;
  readonly mode: string;
  /** REC-005's output, in its order. */
  readonly ranked: readonly BaseRankedCandidate[];
  /** The pool REC-005 ranked, for the declared-taxonomy cluster only. */
  readonly pool: readonly HybridCandidate[];
  /** The instant recency is measured against; the reranker reads no clock. */
  readonly evaluatedAt: string;
  readonly rankerVersion: string;
};

export type RerankService = {
  readonly rerankPool: (query: RerankPoolQuery) => Promise<RerankResult>;
};

export function createRerankService(dependencies: {
  readonly reranker: Reranker;
  readonly signals: RerankSignalsPort;
  readonly reintroductions?: PassReintroductionPort | undefined;
  readonly logger?: Logger | undefined;
}): RerankService {
  const { reranker, signals, reintroductions, logger } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.rerank.runs"),
    moved: meter.createHistogram("discovery.rerank.moved"),
    suppressed: meter.createHistogram("discovery.rerank.suppressed"),
    duration: meter.createHistogram("discovery.rerank.duration_ms"),
  };

  return {
    rerankPool: async (query) => {
      const companyIds = query.ranked.map((r) => r.companyId);
      const clusters = new Map<string, string | null>(
        query.pool.map((c) => [c.companyId, clusterKeyFor(c)] as const),
      );

      const [history, reasons] = await Promise.all([
        companyIds.length === 0
          ? Promise.resolve(
              new Map<
                string,
                { exposed: boolean; lastSeenAt: string | null; passed: boolean }
              >(),
            )
          : signals.forCompanies({
              tenantId: query.tenantId,
              investorOrganisationId: query.investorOrganisationId,
              companyIds,
            }),
        reintroductions === undefined || companyIds.length === 0
          ? Promise.resolve(new Map<string, string>())
          : reintroductions.reasonsFor({
              tenantId: query.tenantId,
              investorOrganisationId: query.investorOrganisationId,
              mandateId: query.mandateId,
              mandateVersion: query.mandateVersion,
              companyIds,
            }),
      ]);

      const facts = new Map<string, RerankFacts>(
        companyIds.map((companyId) => {
          const signal = history.get(companyId);
          const raw = reasons.get(companyId);
          // An unrecognised reason is refused rather than ignored: a
          // typo must not quietly resurface something an investor passed.
          const reintroduction: PassReintroductionReason | null =
            raw === undefined
              ? null
              : PassReintroductionReasonSchema.parse(raw);
          return [
            companyId,
            {
              companyId,
              cluster: clusters.get(companyId) ?? null,
              // Absent history is "never shown, never passed": the honest
              // answer for a company nobody has reached yet.
              exposed: signal?.exposed ?? false,
              lastSeenAt: signal?.lastSeenAt ?? null,
              passed: signal?.passed ?? false,
              reintroduction,
            },
          ] as const;
        }),
      );

      const result = reranker.rerank({
        context: query.mode,
        rankerVersion: query.rankerVersion,
        evaluatedAt: query.evaluatedAt,
        candidates: query.ranked,
        facts,
      });

      const labels = {
        reranker: reranker.version,
        policy: reranker.policyVersion,
      };
      metrics.runs.add(1, labels);
      metrics.moved.record(result.diagnostics.moved, labels);
      metrics.suppressed.record(result.diagnostics.suppressed, labels);
      metrics.duration.record(result.diagnostics.durationMs, labels);
      // Counts and versions only: never a company, a cluster or a score.
      logger?.debug(
        { ...result.diagnostics, policy: reranker.policyVersion },
        "recommendation slate reordered",
      );
      return result;
    },
  };
}
