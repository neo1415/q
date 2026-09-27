import { createHash } from "node:crypto";

import type { TransactionManager } from "@capital-q/database";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { STRUCTURED_GENERATOR_VERSION } from "../candidates/contracts.js";
import { ELIGIBILITY_POLICY_VERSION } from "../eligibility/contracts.js";
import type { EligibilityPorts } from "../eligibility/ports.js";
import { FEATURE_SCHEMA_VERSION } from "../features/contracts.js";
import type { FeatureSnapshotStore } from "../features/ports.js";
import type { HybridCandidateService } from "../hybrid/service.js";
import { RANKER_VERSION, RankingInputError } from "../ranking/contracts.js";
import type { RankingService } from "../ranking/service.js";
import { RerankInputError } from "../rerank/contracts.js";
import type { RerankService } from "../rerank/service.js";
import { SEMANTIC_GENERATOR_VERSION } from "../semantic/contracts.js";
import {
  NewRecommendationItemSchema,
  SLATE_POLICY_V1,
  SlateVersionsSchema,
  type NewRecommendationItem,
  type RecommendationSlate,
  type SlateDiagnostics,
  type SlatePolicy,
  type SlateVersions,
} from "./contracts.js";
import {
  SlateBuildInProgressError,
  type DiscoverablePoolPort,
  type SlateKey,
  type SlateRepository,
} from "./ports.js";

/**
 * The slate builder (CQ-REC-006 Checkpoint B): one pipeline run, persisted.
 *
 *   ACTIVE mandate → REC-002 ∪ REC-003 pool → REC-004 snapshots → REC-005
 *   order → REC-009 bounded reorder → items → fingerprint → (unchanged:
 *   stop) → BUILDING → items → publish, superseding the previous CURRENT
 *   slate in one transaction.
 *
 * The builder still decides nothing about order itself: every item is a
 * ranked candidate with REC-005's internal score untouched, its reason
 * codes, and the exact feature snapshot REC-005 ranked, verified by
 * fingerprint against the store. REC-009 permutes that list within stated
 * bounds and says why each item moved; it can neither add a company nor
 * drop one, because its output is a permutation of its input. Same
 * inputs, same fingerprint, no new slate. A failure after the claim leaves
 * a FAILED row and the served slate untouched.
 */

export const SLATE_FINGERPRINT_VERSION = "slate-fingerprint.v1" as const;

export const SLATE_BUILD_FAILURE_CODES = [
  "SNAPSHOT_MISSING",
  "FINGERPRINT_MISMATCH",
  "RANKER_REFUSED",
  "RERANKER_REFUSED",
  "PUBLISH_FAILED",
  "BUILD_ERROR",
] as const;
export type SlateBuildFailureCode = (typeof SLATE_BUILD_FAILURE_CODES)[number];

export type BuildSlateQuery = {
  /** A human member of the investor organisation the slate is for. */
  readonly actor: ActorContext;
  readonly mode: "INVESTOR_DISCOVER";
  /** Pins one of the investor's mandates; otherwise the single ACTIVE one. */
  readonly mandateId?: string | null | undefined;
};

export type BuildSlateResult =
  | {
      readonly kind: "PUBLISHED";
      readonly slate: RecommendationSlate;
      readonly supersededSlateId: string | null;
      readonly fingerprint: string;
      readonly diagnostics: SlateDiagnostics;
    }
  | {
      /** The CURRENT slate already has this fingerprint and has not expired. */
      readonly kind: "UNCHANGED";
      readonly slate: RecommendationSlate;
      readonly fingerprint: string;
    }
  | { readonly kind: "NO_ACTIVE_MANDATE" }
  | { readonly kind: "NOT_AN_INVESTOR" }
  | { readonly kind: "BUILD_IN_PROGRESS"; readonly key: SlateKey }
  | {
      readonly kind: "FAILED";
      /** The FAILED row, when the claim was taken; null when another build held it. */
      readonly slateId: string | null;
      readonly failureCode: SlateBuildFailureCode;
    };

export type SlateBuilder = {
  readonly build: (query: BuildSlateQuery) => Promise<BuildSlateResult>;
};

export type SlateBuilderDependencies = {
  readonly ports: Pick<
    EligibilityPorts,
    "investorSubject" | "mandates" | "taxonomyVersions"
  >;
  readonly hybrid: HybridCandidateService;
  readonly ranking: RankingService;
  /** REC-009. Required: a build that silently skipped it would serve a different order. */
  readonly rerank: RerankService;
  readonly snapshots: FeatureSnapshotStore;
  readonly slates: SlateRepository;
  readonly transactions: TransactionManager;
  /**
   * When present, an empty CURRENT slate generated before the newest change
   * in what is discoverable is republished even when its fingerprint is
   * unchanged, so the reader's "is this empty slate stale?" question
   * (ADR 0019) is answered once rather than on every read.
   */
  readonly pool?: DiscoverablePoolPort | undefined;
  readonly policy?: SlatePolicy | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

/** A refusal the builder recognises and records under a bounded code. */
export class SlateBuildError extends Error {
  readonly code: SlateBuildFailureCode;
  constructor(code: SlateBuildFailureCode, message: string) {
    super(message);
    this.name = "SlateBuildError";
    this.code = code;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * The deterministic identity of a build: who it is for, which versions
 * produced it and the ranked items with their snapshot fingerprints.
 * Never a timestamp, an id or a diagnostic count.
 */
export function slateFingerprint(input: {
  readonly key: SlateKey;
  readonly mandateVersion: number;
  readonly versions: SlateVersions;
  /**
   * REC-009's policy. It is not one of `versions` because those are
   * columns and this is not; it belongs in the identity all the same,
   * because a policy change produces an order the old fingerprint would
   * otherwise claim was still current.
   */
  readonly rerankPolicyVersion: string;
  readonly items: readonly Pick<
    NewRecommendationItem,
    "companyId" | "rank" | "featureSnapshotFingerprint"
  >[];
}): string {
  const body = canonical({
    v: SLATE_FINGERPRINT_VERSION,
    tenantId: input.key.tenantId,
    investorOrganisationId: input.key.investorOrganisationId,
    mandateId: input.key.mandateId,
    mandateVersion: input.mandateVersion,
    mode: input.key.mode,
    versions: input.versions,
    rerankPolicyVersion: input.rerankPolicyVersion,
    items: input.items.map((i) => [
      i.companyId,
      i.rank,
      i.featureSnapshotFingerprint,
    ]),
  });
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function failureCodeOf(error: unknown): SlateBuildFailureCode {
  if (error instanceof SlateBuildError) return error.code;
  if (error instanceof RankingInputError) return "RANKER_REFUSED";
  if (error instanceof RerankInputError) return "RERANKER_REFUSED";
  return "BUILD_ERROR";
}

export function createSlateBuilder(
  dependencies: SlateBuilderDependencies,
): SlateBuilder {
  const {
    ports,
    hybrid,
    ranking,
    rerank,
    snapshots,
    slates,
    transactions,
    pool: discoverablePool,
    logger,
  } = dependencies;
  const policy = dependencies.policy ?? SLATE_POLICY_V1;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    builds: meter.createCounter("discovery.slates.builds"),
    items: meter.createHistogram("discovery.slates.items"),
    duration: meter.createHistogram("discovery.slates.build_duration_ms"),
  };

  return {
    build: async (query) => {
      const started = performance.now();
      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        metrics.builds.add(1, { outcome: "NOT_AN_INVESTOR" });
        return { kind: "NOT_AN_INVESTOR" };
      }
      const lookup = await ports.mandates.activeMandate({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        mandateId: query.mandateId ?? null,
      });
      if (
        lookup.kind !== "FOUND" ||
        lookup.mandate.status !== "ACTIVE" ||
        lookup.mandate.investorOrganisationId !== subject.investorOrganisationId
      ) {
        metrics.builds.add(1, { outcome: "NO_ACTIVE_MANDATE" });
        return { kind: "NO_ACTIVE_MANDATE" };
      }
      const mandate = lookup.mandate;
      const key: SlateKey = {
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        mandateId: mandate.mandateId,
        mode: query.mode,
      };

      let slateId: string | null = null;
      try {
        // The pipeline, as REC-002 to REC-005 run it; nothing is re-ranked here.
        const pool = await hybrid.generate({
          actor: query.actor,
          mandateId: mandate.mandateId,
          limit: policy.candidatePoolMax,
          topK: policy.semanticTopK,
        });
        if (pool.kind === "NO_ACTIVE_MANDATE") {
          metrics.builds.add(1, { outcome: "NO_ACTIVE_MANDATE" });
          return { kind: "NO_ACTIVE_MANDATE" };
        }
        const eligible = pool.candidates.filter(
          (c) => c.eligibility.decision === "ELIGIBLE",
        );
        const rankedResult = await ranking.rankCandidates({
          actor: query.actor,
          mode: query.mode,
          mandateId: mandate.mandateId,
          candidates: eligible,
        });
        if (rankedResult.kind === "NO_ACTIVE_MANDATE") {
          metrics.builds.add(1, { outcome: "NO_ACTIVE_MANDATE" });
          return { kind: "NO_ACTIVE_MANDATE" };
        }
        const ranked = rankedResult.ranked;

        // REC-009. The build's own instant is what recency is measured
        // against, so the slate and the question "had they just seen it"
        // agree on when this happened.
        const generatedAt = clock();
        const reordered = await rerank.rerankPool({
          tenantId: key.tenantId,
          investorOrganisationId: key.investorOrganisationId,
          mandateId: key.mandateId,
          mandateVersion: mandate.version,
          mode: key.mode,
          ranked: ranked.map((r) => ({
            companyId: r.companyId,
            rank: r.rank,
            internalScore: r.internalScore,
          })),
          pool: eligible,
          evaluatedAt: generatedAt.toISOString(),
          rankerVersion: RANKER_VERSION,
        });
        const rankedById = new Map(
          ranked.map((r) => [r.companyId, r] as const),
        );

        // Every item names the stored snapshot it was ranked from, and the
        // store must agree on the fingerprint: an item never points at a
        // snapshot other than the one REC-005 scored.
        const refs = await snapshots.currentFor({
          tenantId: key.tenantId,
          investorOrganisationId: key.investorOrganisationId,
          mandateId: key.mandateId,
          mode: key.mode,
          featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          companyIds: ranked.map((r) => r.companyId),
        });
        const items: NewRecommendationItem[] = reordered.candidates.map(
          (rc) => {
            const r = rankedById.get(rc.companyId);
            if (r === undefined) {
              // A reorder is a permutation; anything else is a defect here,
              // not something to serve.
              throw new SlateBuildError(
                "BUILD_ERROR",
                "the reordered slate names a company the ranker did not",
              );
            }
            const ref = refs.get(rc.companyId);
            if (ref === undefined) {
              throw new SlateBuildError(
                "SNAPSHOT_MISSING",
                "a ranked candidate has no current feature snapshot",
              );
            }
            if (ref.fingerprint !== r.featureSnapshot.fingerprint) {
              throw new SlateBuildError(
                "FINGERPRINT_MISMATCH",
                "the stored feature snapshot is not the one that was ranked",
              );
            }
            return NewRecommendationItemSchema.parse({
              companyId: rc.companyId,
              companyTenantId: ref.companyTenantId,
              // REC-009's position; REC-005's score, unchanged beside it. The
              // base rank is not stored because it is recoverable exactly
              // from the stored scores under REC-005's own tie-break.
              rank: rc.rank,
              internalScore: r.internalScore,
              // Reordering codes first: they are the few, and a pool with an
              // unusually wide set of scoring codes must not push out the
              // record of why an item moved.
              reasonCodes: [
                ...new Set([...rc.rerankReasonCodes, ...r.reasonCodes]),
              ].slice(0, 32),
              featureSnapshotId: ref.id,
              featureSnapshotFingerprint: ref.fingerprint,
              candidateProvenance: r.candidateProvenance,
            });
          },
        );

        const versions = SlateVersionsSchema.parse({
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          structuredGeneratorVersion: STRUCTURED_GENERATOR_VERSION,
          // A degraded run is a structured-only slate and says so; when the
          // semantic generator returns, the fingerprint changes and a
          // rebuild supersedes it.
          semanticGeneratorVersion:
            pool.semanticUnavailable === null
              ? SEMANTIC_GENERATOR_VERSION
              : null,
          featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          rankerVersion: RANKER_VERSION,
          rankingConfigVersion: rankedResult.diagnostics.rankingConfigVersion,
          taxonomyVersion: pool.context.taxonomyVersion,
        });
        const fingerprint = slateFingerprint({
          key,
          mandateVersion: mandate.version,
          versions,
          rerankPolicyVersion: reordered.rerankPolicyVersion,
          items,
        });

        const now = generatedAt;
        const current = await slates.findCurrent(key);
        const staleEmpty =
          current !== null &&
          current.itemCount === 0 &&
          discoverablePool !== undefined &&
          (await discoverablePool
            .summary({
              excludeOrganisationId: key.investorOrganisationId,
              sample: 0,
            })
            .then(
              (s) =>
                s.latestChangeAt !== null &&
                Date.parse(s.latestChangeAt) > Date.parse(current.generatedAt),
            ));
        if (
          current !== null &&
          !staleEmpty &&
          current.generationFingerprint === fingerprint &&
          current.expiresAt !== null &&
          Date.parse(current.expiresAt) > now.getTime()
        ) {
          metrics.builds.add(1, { outcome: "UNCHANGED" });
          logger?.debug(
            { slateId: current.id, mode: key.mode, items: items.length },
            "recommendation slate unchanged",
          );
          return { kind: "UNCHANGED", slate: current, fingerprint };
        }

        let building: RecommendationSlate;
        try {
          building = await slates.beginBuild({
            ...key,
            mandateVersion: mandate.version,
            versions,
            generatedAt: now.toISOString(),
          });
        } catch (error: unknown) {
          if (error instanceof SlateBuildInProgressError) {
            metrics.builds.add(1, { outcome: "BUILD_IN_PROGRESS" });
            return { kind: "BUILD_IN_PROGRESS", key };
          }
          throw error;
        }
        slateId = building.id;
        await slates.insertItems(building.id, key.tenantId, items);

        const buildDurationMs = Math.round(performance.now() - started);
        const diagnostics: SlateDiagnostics = {
          structuredCandidates: pool.diagnostics.structured.eligible,
          semanticCandidates: pool.diagnostics.semantic?.eligible ?? 0,
          semanticUnavailable: pool.semanticUnavailable !== null,
          mergedCandidates: pool.diagnostics.merged,
          featureSnapshots:
            rankedResult.diagnostics.features.inserted +
            rankedResult.diagnostics.features.reused,
          ranked: ranked.length,
          scored: rankedResult.diagnostics.scored,
          rerankPolicyVersion: reordered.rerankPolicyVersion,
          reranked: reordered.diagnostics.moved,
          rerankSuppressed: reordered.diagnostics.suppressed,
          rerankExplorationSlots: reordered.diagnostics.explorationSlots,
          buildDurationMs,
        };
        const publishedAt = clock();
        let published;
        try {
          published = await slates.publish(transactions, {
            slateId: building.id,
            generationFingerprint: fingerprint,
            itemCount: items.length,
            diagnostics,
            publishedAt: publishedAt.toISOString(),
            expiresAt: new Date(
              publishedAt.getTime() + policy.ttlMs,
            ).toISOString(),
          });
        } catch (error: unknown) {
          throw new SlateBuildError(
            "PUBLISH_FAILED",
            error instanceof Error ? error.message : "publish failed",
          );
        }

        metrics.builds.add(1, { outcome: "PUBLISHED" });
        metrics.items.record(items.length, { mode: key.mode });
        metrics.duration.record(buildDurationMs, { mode: key.mode });
        // Identifiers, counts and versions only.
        logger?.info(
          {
            slateId: published.slate.id,
            supersededSlateId: published.supersededSlateId,
            mode: key.mode,
            items: items.length,
            semanticUnavailable: diagnostics.semanticUnavailable,
            buildDurationMs,
          },
          "recommendation slate published",
        );
        return {
          kind: "PUBLISHED",
          slate: published.slate,
          supersededSlateId: published.supersededSlateId,
          fingerprint,
          diagnostics,
        };
      } catch (error: unknown) {
        const failureCode = failureCodeOf(error);
        if (slateId === null) {
          // Record the attempt when no other build holds the claim; the
          // served slate is untouched either way.
          try {
            const failed = await slates.beginBuild({
              ...key,
              mandateVersion: mandate.version,
              versions: SlateVersionsSchema.parse({
                eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
                structuredGeneratorVersion: STRUCTURED_GENERATOR_VERSION,
                semanticGeneratorVersion: SEMANTIC_GENERATOR_VERSION,
                featureSchemaVersion: FEATURE_SCHEMA_VERSION,
                rankerVersion: RANKER_VERSION,
                rankingConfigVersion: "ranking-config.unknown",
                taxonomyVersion: null,
              }),
              generatedAt: clock().toISOString(),
            });
            slateId = failed.id;
          } catch (claim: unknown) {
            if (!(claim instanceof SlateBuildInProgressError)) throw claim;
          }
        }
        if (slateId !== null) await slates.fail(slateId, failureCode);
        metrics.builds.add(1, { outcome: "FAILED", code: failureCode });
        logger?.warn(
          { slateId, mode: key.mode, failureCode, err: error },
          "recommendation slate build failed",
        );
        return { kind: "FAILED", slateId, failureCode };
      }
    },
  };
}
