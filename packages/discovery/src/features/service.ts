import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { deriveStructuredIntent } from "../candidates/structured.js";
import { ELIGIBILITY_POLICY_VERSION } from "../eligibility/contracts.js";
import type {
  EligibilityResult,
  RecommendationMode,
} from "../eligibility/contracts.js";
import type { EligibilityPorts } from "../eligibility/ports.js";
import type { HybridCandidate } from "../hybrid/contracts.js";
import {
  FEATURE_SCHEMA_VERSION,
  RecommendationFeatureSnapshotSchema,
  type RecommendationFeatureSnapshot,
} from "./contracts.js";
import {
  computeFeatureValues,
  snapshotFingerprint,
  snapshotSensitivity,
  toSnapshotCandidateProvenance,
  type CandidateProvenanceProjection,
  type FeatureRegistry,
} from "./policy.js";
import type {
  CompanyFeatureProjectionPort,
  FeatureSnapshotStore,
  PreferenceHierarchyPort,
} from "./ports.js";

/**
 * The recommendation feature service (doc 19 §38–§42, §147; CQ-REC-004
 * §45–§46): the only legitimate input surface for a ranker.
 *
 *   resolve investor + ACTIVE mandate (REC-001's ports)
 *   → refuse a context the registry does not allow, and any candidate
 *     that is not ELIGIBLE for this mandate
 *   → one batch read of company state + declared taxonomy
 *   → one expansion of the mandate's positive preference nodes
 *   → pure computation per candidate, registry order
 *   → fingerprint, persist (reuse identical, supersede changed)
 *
 * No model, no embedding, no query per feature, no wall-clock feature.
 * Semantic similarity is read from REC-003's provenance, never recomputed.
 */

export type ComputeFeaturesQuery = {
  readonly actor: ActorContext;
  readonly mode: RecommendationMode;
  /** Pins one of the actor's own mandates; otherwise the single ACTIVE one. */
  readonly mandateId?: string | null | undefined;
  /** ELIGIBLE candidates from the hybrid pool (or either generator). */
  readonly candidates: readonly HybridCandidate[];
  /** Whether to persist; a pure computation is allowed for diagnostics. */
  readonly persist?: boolean | undefined;
};

export type FeatureComputationDiagnostics = {
  readonly featureSchemaVersion: typeof FEATURE_SCHEMA_VERSION;
  readonly candidates: number;
  /** Candidates whose projection was absent (went private/closed since retrieval); skipped, never invented. */
  readonly withoutProjection: number;
  readonly featureValues: number;
  readonly present: number;
  readonly missing: number;
  readonly notApplicable: number;
  readonly scopeViolations: number;
  /** Store outcome, when persisted. */
  readonly reused: number;
  readonly superseded: number;
  readonly inserted: number;
  readonly queries: number;
  readonly computeDurationMs: number;
  readonly persistDurationMs: number;
};

export type ComputeFeaturesResult =
  | {
      readonly kind: "COMPUTED";
      readonly snapshots: readonly RecommendationFeatureSnapshot[];
      readonly diagnostics: FeatureComputationDiagnostics;
    }
  | { readonly kind: "NO_ACTIVE_MANDATE" };

export class CandidateNotRankableError extends Error {
  readonly companyId: string;
  constructor(companyId: string, why: string) {
    super(`candidate ${companyId} is not rankable: ${why}`);
    this.name = "CandidateNotRankableError";
    this.companyId = companyId;
  }
}

export type FeatureService = {
  readonly computeForCandidates: (
    query: ComputeFeaturesQuery,
  ) => Promise<ComputeFeaturesResult>;
};

export type FeatureServiceDependencies = {
  readonly registry: FeatureRegistry;
  readonly ports: Pick<
    EligibilityPorts,
    "investorSubject" | "mandates" | "taxonomyVersions"
  >;
  readonly companies: CompanyFeatureProjectionPort;
  readonly hierarchy: PreferenceHierarchyPort;
  readonly store: FeatureSnapshotStore;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

function assertRankable(
  candidate: HybridCandidate,
  expected: {
    readonly mandateId: string;
    readonly investorOrganisationId: string;
  },
): EligibilityResult {
  const e = candidate.eligibility;
  if (e.decision !== "ELIGIBLE") {
    throw new CandidateNotRankableError(
      candidate.companyId,
      `decision ${e.decision}`,
    );
  }
  if (e.mandateId !== expected.mandateId) {
    throw new CandidateNotRankableError(
      candidate.companyId,
      "eligibility is for another mandate",
    );
  }
  if (e.investorOrganisationId !== expected.investorOrganisationId) {
    throw new CandidateNotRankableError(
      candidate.companyId,
      "eligibility is for another investor",
    );
  }
  if (e.companyId !== candidate.companyId) {
    throw new CandidateNotRankableError(
      candidate.companyId,
      "eligibility is for another company",
    );
  }
  return e;
}

export function createFeatureService(
  dependencies: FeatureServiceDependencies,
): FeatureService {
  const { registry, ports, companies, hierarchy, store, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.features.runs"),
    candidates: meter.createHistogram("discovery.features.candidates"),
    present: meter.createHistogram("discovery.features.present"),
    missing: meter.createHistogram("discovery.features.missing"),
    scopeViolations: meter.createCounter("discovery.features.scope_violations"),
    contextRefused: meter.createCounter("discovery.features.context_refused"),
    duration: meter.createHistogram("discovery.features.compute_duration_ms"),
  };

  return {
    computeForCandidates: async (query) => {
      const started = performance.now();
      // Fail closed before any read: a context the registry does not name
      // gets nothing, whatever candidates it brought.
      let definitions;
      try {
        definitions = registry.featuresFor(query.mode);
      } catch (error: unknown) {
        metrics.contextRefused.add(1, { mode: query.mode });
        throw error;
      }

      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        throw new Error(
          "the acting organisation has no canonical investor organisation",
        );
      }
      const investorOrganisationId = subject.investorOrganisationId;
      let queries = 0;
      const [lookup, taxonomyVersion] = await Promise.all([
        ports.mandates.activeMandate({
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mandateId: query.mandateId ?? null,
        }),
        ports.taxonomyVersions?.currentVersions() ?? Promise.resolve(null),
      ]);
      queries += 2;
      if (
        lookup.kind !== "FOUND" ||
        lookup.mandate.status !== "ACTIVE" ||
        lookup.mandate.investorOrganisationId !== investorOrganisationId
      ) {
        return { kind: "NO_ACTIVE_MANDATE" };
      }
      const mandate = lookup.mandate;
      const context = {
        tenantId: query.actor.tenantId,
        investorOrganisationId,
        mode: query.mode,
        mandateId: mandate.mandateId,
        taxonomyVersion,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
      };

      // Only ELIGIBLE candidates for this investor and mandate are rankable
      // input; anything else is a caller error, not a feature.
      const ordered = [...query.candidates].sort((a, b) =>
        a.companyId.localeCompare(b.companyId),
      );
      for (const candidate of ordered) {
        assertRankable(candidate, {
          mandateId: mandate.mandateId,
          investorOrganisationId,
        });
      }

      // Two batch reads for the whole pool, never one per feature.
      const intent = deriveStructuredIntent(mandate);
      const [projections, expanded] = await Promise.all([
        companies.projectMany(ordered.map((c) => c.companyId)),
        hierarchy.expand(intent.taxonomyNodeIds),
      ]);
      queries += 2;

      const snapshots: RecommendationFeatureSnapshot[] = [];
      let withoutProjection = 0;
      let present = 0;
      let missing = 0;
      let notApplicable = 0;
      let scopeViolations = 0;
      const computedAt = clock().toISOString();
      for (const candidate of ordered) {
        const projection = projections.get(candidate.companyId);
        if (projection === undefined) {
          // Retrieved earlier, not discoverable now: nothing is computed
          // from a company that may no longer be shown.
          withoutProjection += 1;
          continue;
        }
        const provenance: CandidateProvenanceProjection = {
          structured:
            candidate.structured === null
              ? null
              : {
                  sourceClass: "STRUCTURED_CANDIDATE_PROVENANCE",
                  generatorVersion: candidate.structured.generatorVersion,
                  reasonCodes: candidate.structured.reasonCodes,
                },
          semantic:
            candidate.semantic === null
              ? null
              : {
                  sourceClass: "SEMANTIC_CANDIDATE_PROVENANCE",
                  generatorVersion: candidate.semantic.generatorVersion,
                  companyRepresentationVersion:
                    candidate.semantic.companyRepresentationVersion,
                  investorRepresentationVersion:
                    candidate.semantic.investorRepresentationVersion,
                  configurationVersion: candidate.semantic.configurationVersion,
                  similarity: candidate.semantic.similarity,
                },
        };
        const computed = computeFeatureValues(definitions, {
          mandate: { ...mandate, sourceClass: "DECLARED_MANDATE" },
          company: projection.state,
          taxonomy: projection.taxonomy,
          hierarchy: expanded,
          candidate: provenance,
          eligibility: {
            sourceClass: "ELIGIBILITY_RESULT",
            decision: candidate.eligibility.decision,
            policyVersion: candidate.eligibility.eligibilityPolicyVersion,
          },
        });
        scopeViolations += computed.scopeViolations;
        for (const v of computed.values) {
          if (v.status === "PRESENT") present += 1;
          else if (v.status === "MISSING") missing += 1;
          else notApplicable += 1;
        }
        const body = {
          featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          context,
          mandateId: mandate.mandateId,
          mandateVersion: mandate.version,
          companyId: candidate.companyId,
          companyTenantId: projection.state.tenantId,
          companyProjectionVersion: projection.state.version,
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          eligibilityDecision: candidate.eligibility.decision,
          candidateProvenance: toSnapshotCandidateProvenance(provenance),
          sensitivity: snapshotSensitivity(computed.values),
          features: [...computed.values],
        };
        const snapshot = RecommendationFeatureSnapshotSchema.parse({
          ...body,
          fingerprint: snapshotFingerprint({ definitions, snapshot: body }),
          computedAt,
        });
        const problems = registry.validateSnapshot(snapshot);
        if (problems.length > 0) {
          throw new Error(`feature snapshot invalid: ${problems.join("; ")}`);
        }
        snapshots.push(snapshot);
      }
      const computeDurationMs = Math.round(performance.now() - started);

      let reused = 0;
      let superseded = 0;
      let inserted = 0;
      let persistDurationMs = 0;
      if ((query.persist ?? true) && snapshots.length > 0) {
        const persistStarted = performance.now();
        const current = await store.currentFor({
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mandateId: mandate.mandateId,
          mode: query.mode,
          featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          companyIds: snapshots.map((s) => s.companyId),
        });
        queries += 1;
        const toSupersede: string[] = [];
        const toInsert: RecommendationFeatureSnapshot[] = [];
        for (const snapshot of snapshots) {
          const existing = current.get(snapshot.companyId);
          if (existing === undefined) {
            toInsert.push(snapshot);
          } else if (existing.fingerprint === snapshot.fingerprint) {
            reused += 1;
          } else {
            toSupersede.push(existing.id);
            toInsert.push(snapshot);
          }
        }
        if (toSupersede.length > 0) {
          await store.supersede(toSupersede);
          queries += 1;
          superseded = toSupersede.length;
        }
        if (toInsert.length > 0) {
          await store.insertMany(toInsert);
          queries += 1;
          inserted = toInsert.length;
        }
        persistDurationMs = Math.round(performance.now() - persistStarted);
      }

      const diagnostics: FeatureComputationDiagnostics = {
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        candidates: ordered.length,
        withoutProjection,
        featureValues: snapshots.length * definitions.length,
        present,
        missing,
        notApplicable,
        scopeViolations,
        reused,
        superseded,
        inserted,
        queries,
        computeDurationMs,
        persistDurationMs,
      };
      metrics.runs.add(1, { mode: query.mode, schema: FEATURE_SCHEMA_VERSION });
      metrics.candidates.record(ordered.length, { mode: query.mode });
      metrics.present.record(present, { mode: query.mode });
      metrics.missing.record(missing, { mode: query.mode });
      if (scopeViolations > 0) {
        metrics.scopeViolations.add(scopeViolations, { mode: query.mode });
      }
      metrics.duration.record(computeDurationMs, { mode: query.mode });
      // Counts and versions only: never a value, a mandate field or a marker.
      logger?.debug(
        { mandateVersion: mandate.version, ...diagnostics },
        "recommendation features computed",
      );
      return { kind: "COMPUTED", snapshots, diagnostics };
    },
  };
}
