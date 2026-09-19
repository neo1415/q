import {
  FEATURE_SCHEMA_VERSION,
  SnapshotCandidateProvenanceSchema,
  type FeatureValue,
  type RecommendationFeatureSnapshot,
} from "../features/contracts.js";
import {
  snapshotFingerprint,
  type FeatureRegistry,
} from "../features/policy.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  type RecommendationContext,
} from "../eligibility/contracts.js";
import {
  validateRankingConfig,
  type Normalization,
  type RankingConfig,
  type RankingReasonCode,
} from "./config.js";
import {
  RANKER_ID,
  RANKER_VERSION,
  RankingInputError,
  type FactorResult,
  type RankedCandidate,
} from "./contracts.js";

/**
 * The deterministic V1 ranker (doc 19 §108, §110–§112; CQ-REC-005).
 *
 * Pure: its only inputs are REC-004 feature snapshots and a ranking
 * config; it reads no database, calls no model, draws no random number and
 * reads no clock. For each candidate:
 *
 *   validate (context, tenant, investor, mandate + version, company,
 *            schema, registry allowlist + versions, eligibility, fingerprint)
 *   → for every configured factor: PRESENT → normalise by the config →
 *     contribute normalized × weight; MISSING / NOT_APPLICABLE → excluded
 *   → score = Σ(normalized × weight) ÷ Σ(weight of present factors)
 *     (null when no factor is present — unscored, never "poor")
 *   → order: score descending, then canonical company id; unscored last
 *
 * Missing is never zero, coverage is never a penalty, the eligibility gate
 * is never weighted, and nothing outside the config adds or subtracts.
 */

/** Doc 19 §108. A learned ranker would implement the same boundary. */
export type Ranker = {
  readonly id: typeof RANKER_ID;
  readonly version: typeof RANKER_VERSION;
  readonly configVersion: string;
  readonly rank: (
    context: RankingContext,
    candidates: readonly EnrichedCandidate[],
  ) => Promise<readonly RankedCandidate[]>;
};

/** What the trusted composition says the ranking is for. */
export type RankingContext = {
  readonly recommendation: RecommendationContext;
  /** The ACTIVE mandate version every snapshot must have been computed at. */
  readonly mandateVersion: number;
};

/** One candidate: its identity and the governed feature snapshot for it. */
export type EnrichedCandidate = {
  readonly companyId: string;
  readonly snapshot: RecommendationFeatureSnapshot;
};

/** The config's mapping of one present feature value into [0, 1]. */
export function normalizeFactorValue(
  normalization: Normalization,
  value: FeatureValue["value"],
): {
  readonly normalized: number;
  readonly polarity: "POSITIVE" | "SOFT_MISMATCH" | "SIGNAL";
  readonly reasonCode: RankingReasonCode;
} | null {
  if (normalization.kind === "CATEGORY_MAP") {
    if (typeof value !== "string") return null;
    const entry = normalization.map[value];
    if (entry === undefined) return null;
    return {
      normalized: entry.value,
      polarity: entry.polarity,
      reasonCode: entry.reasonCode,
    };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const t =
    (value - normalization.inMin) / (normalization.inMax - normalization.inMin);
  return {
    normalized: Math.min(1, Math.max(0, t)),
    polarity: "SIGNAL",
    reasonCode: normalization.reasonCode,
  };
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * Score one validated snapshot under one config. Pure; every number it
 * produces is reproducible from the config and the snapshot alone.
 */
export function scoreSnapshot(
  config: RankingConfig,
  snapshot: RecommendationFeatureSnapshot,
): {
  readonly score: number | null;
  readonly factors: readonly FactorResult[];
  readonly reasonCodes: readonly RankingReasonCode[];
  readonly diagnostics: RankedCandidate["diagnostics"];
} {
  const byId = new Map(snapshot.features.map((f) => [f.featureId, f] as const));
  type Pending = Omit<FactorResult, "contribution">;
  const pending: Pending[] = [];
  let configuredWeight = 0;
  let availableWeight = 0;
  let numerator = 0;
  let present = 0;
  let missing = 0;
  let notApplicable = 0;

  for (const factor of config.factors) {
    configuredWeight += factor.weight;
    const value = byId.get(factor.featureId);
    if (value === undefined) {
      // Validation guarantees presence; unreachable for a validated snapshot.
      throw new RankingInputError(
        "SNAPSHOT_INVALID",
        snapshot.companyId,
        `${factor.featureId} absent`,
      );
    }
    const base = {
      featureId: factor.featureId,
      featureVersion: value.featureVersion,
      group: factor.group,
      featureStatus: value.status,
      featureValue: typeof value.value === "boolean" ? null : value.value,
      missingReason: value.missingReason,
      configuredWeight: factor.weight,
      sourceClasses: value.sourceClasses,
    };
    if (value.status !== "PRESENT") {
      if (value.status === "MISSING") missing += 1;
      else notApplicable += 1;
      pending.push({
        ...base,
        outcome: value.status === "MISSING" ? "MISSING" : "NOT_APPLICABLE",
        normalizedValue: null,
        polarity: null,
        reasonCode:
          value.status === "MISSING"
            ? "FACTOR_MISSING"
            : "FACTOR_NOT_APPLICABLE",
      });
      continue;
    }
    const mapped = normalizeFactorValue(factor.normalization, value.value);
    if (mapped === null) {
      throw new RankingInputError(
        "SNAPSHOT_INVALID",
        snapshot.companyId,
        `${factor.featureId} value is outside the config's mapping`,
      );
    }
    present += 1;
    availableWeight += factor.weight;
    numerator += mapped.normalized * factor.weight;
    pending.push({
      ...base,
      outcome: "SCORED",
      normalizedValue: mapped.normalized,
      polarity: mapped.polarity,
      reasonCode: mapped.reasonCode,
    });
  }

  const scored = availableWeight > 0;
  const factors: FactorResult[] = pending.map((p) => ({
    ...p,
    contribution:
      scored && p.outcome === "SCORED" && p.normalizedValue !== null
        ? (p.normalizedValue * p.configuredWeight) / availableWeight
        : null,
  }));
  const score = scored
    ? round(numerator / availableWeight, config.scorePrecision)
    : null;
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) {
    throw new RankingInputError(
      "SNAPSHOT_INVALID",
      snapshot.companyId,
      "score outside [0, 1]",
    );
  }
  const reasons: RankingReasonCode[] = [];
  for (const f of factors) {
    if (f.outcome === "SCORED" && !reasons.includes(f.reasonCode))
      reasons.push(f.reasonCode);
  }
  if (!scored) reasons.push("NO_SCOREABLE_FEATURES");
  return {
    score,
    factors,
    reasonCodes: reasons,
    diagnostics: {
      configuredWeight,
      availableWeight,
      factorCoverage:
        configuredWeight === 0 ? 0 : availableWeight / configuredWeight,
      presentFactorCount: present,
      missingFactorCount: missing,
      notApplicableFactorCount: notApplicable,
    },
  };
}

/**
 * Refuse anything that is not a current, coherent, governed snapshot for
 * exactly this context (CQ-REC-005 §10–§13, §51–§53, §78). Throws; nothing
 * is ranked from a pool that contains one bad input.
 */
export function validateRankingInput(
  config: RankingConfig,
  registry: FeatureRegistry,
  context: RankingContext,
  candidate: EnrichedCandidate,
): void {
  const s = candidate.snapshot;
  const c = context.recommendation;
  const id = candidate.companyId;
  if (c.mode !== config.context) {
    throw new RankingInputError(
      "CONTEXT_NOT_SUPPORTED",
      null,
      `${config.version} ranks ${config.context}, not ${c.mode}`,
    );
  }
  if (s.context.mode !== c.mode) {
    throw new RankingInputError(
      "CONTEXT_MISMATCH",
      id,
      `snapshot context ${s.context.mode}`,
    );
  }
  if (s.context.tenantId !== c.tenantId) {
    throw new RankingInputError(
      "TENANT_MISMATCH",
      id,
      "snapshot belongs to another tenant",
    );
  }
  if (s.context.investorOrganisationId !== c.investorOrganisationId) {
    throw new RankingInputError(
      "INVESTOR_MISMATCH",
      id,
      "snapshot belongs to another investor organisation",
    );
  }
  if (
    c.mandateId === null ||
    s.mandateId !== c.mandateId ||
    s.context.mandateId !== c.mandateId
  ) {
    throw new RankingInputError(
      "MANDATE_MISMATCH",
      id,
      "snapshot was computed for another mandate",
    );
  }
  if (s.mandateVersion !== context.mandateVersion) {
    throw new RankingInputError(
      "MANDATE_VERSION_MISMATCH",
      id,
      `snapshot at mandate version ${String(s.mandateVersion)}, ranking at ${String(context.mandateVersion)}`,
    );
  }
  if (s.companyId !== id) {
    throw new RankingInputError(
      "COMPANY_MISMATCH",
      id,
      "snapshot describes another company",
    );
  }
  if (
    s.featureSchemaVersion !== config.requiredFeatureSchemaVersion ||
    s.featureSchemaVersion !== FEATURE_SCHEMA_VERSION
  ) {
    throw new RankingInputError(
      "FEATURE_SCHEMA_MISMATCH",
      id,
      `${String(s.featureSchemaVersion)}`,
    );
  }
  // Upstream versions: a snapshot computed under a superseded eligibility
  // policy or candidate generator is stale input, whatever its fingerprint
  // says (a v1-era snapshot is self-consistent). It is refused, never
  // re-labelled; the feature service recomputes it under current versions.
  if (
    String(s.eligibilityPolicyVersion) !== ELIGIBILITY_POLICY_VERSION ||
    String(s.context.eligibilityPolicyVersion) !== ELIGIBILITY_POLICY_VERSION
  ) {
    throw new RankingInputError(
      "ELIGIBILITY_POLICY_MISMATCH",
      id,
      `computed under ${String(s.eligibilityPolicyVersion)}, current is ${ELIGIBILITY_POLICY_VERSION}`,
    );
  }
  if (
    !SnapshotCandidateProvenanceSchema.safeParse(s.candidateProvenance).success
  ) {
    throw new RankingInputError(
      "CANDIDATE_VERSION_MISMATCH",
      id,
      "candidate provenance names a generator or representation version this ranker does not know",
    );
  }
  // The registry's own check: exactly the features allowed in this context,
  // in registry order, each at its registered version, type and class.
  const problems = registry.validateSnapshot(s);
  if (problems.length > 0) {
    const allowed = new Set(registry.featuresFor(c.mode).map((d) => d.id));
    const foreign = s.features.find((f) => !allowed.has(f.featureId));
    if (foreign !== undefined) {
      throw new RankingInputError(
        "FEATURE_NOT_ALLOWED",
        id,
        `${foreign.featureId} is not allowed in ${c.mode}`,
      );
    }
    throw new RankingInputError("SNAPSHOT_INVALID", id, problems.join("; "));
  }
  // The config's own versions: a mapping written for v1 never reads v2.
  for (const factor of config.factors) {
    const value = s.features.find((f) => f.featureId === factor.featureId);
    if (value === undefined || value.featureVersion !== factor.featureVersion) {
      throw new RankingInputError(
        "FEATURE_VERSION_MISMATCH",
        id,
        `${factor.featureId} expected ${factor.featureVersion}`,
      );
    }
  }
  // Eligibility is a gate: an ineligible or gate-false snapshot is not
  // rankable input at all, never a low score.
  const gate = s.features.find((f) => f.featureId === "eligibility.hard_gate");
  if (
    s.eligibilityDecision !== "ELIGIBLE" ||
    gate === undefined ||
    gate.status !== "PRESENT" ||
    gate.value !== true
  ) {
    throw new RankingInputError(
      "NOT_ELIGIBLE",
      id,
      "only ELIGIBLE candidates are ranked",
    );
  }
  // The artifact is what the feature service produced: its fingerprint
  // still matches its content.
  const { fingerprint, computedAt: _computedAt, ...body } = s;
  const expected = snapshotFingerprint({
    definitions: registry.featuresFor(c.mode),
    snapshot: body,
  });
  if (expected !== fingerprint) {
    throw new RankingInputError(
      "FINGERPRINT_MISMATCH",
      id,
      "snapshot content does not match its fingerprint",
    );
  }
}

/**
 * Rank a pool. Pure and synchronous; the async `Ranker.rank` wraps it.
 * Order: scored by score descending then company id ascending; unscored
 * after, by company id ascending. No other key exists.
 */
export function rankSnapshots(
  config: RankingConfig,
  registry: FeatureRegistry,
  context: RankingContext,
  candidates: readonly EnrichedCandidate[],
): {
  readonly ranked: readonly RankedCandidate[];
  readonly belowThreshold: number;
} {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.companyId)) {
      throw new RankingInputError(
        "DUPLICATE_COMPANY",
        candidate.companyId,
        "one snapshot per company",
      );
    }
    ids.add(candidate.companyId);
    validateRankingInput(config, registry, context, candidate);
  }
  const scoredAll = candidates.map((candidate) => ({
    candidate,
    result: scoreSnapshot(config, candidate.snapshot),
  }));
  const minimum = config.thresholds.minimumFit;
  const kept = scoredAll.filter(
    (x) =>
      minimum === null || x.result.score === null || x.result.score >= minimum,
  );
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  kept.sort((a, b) => {
    const sa = a.result.score;
    const sb = b.result.score;
    if (sa !== null && sb !== null) {
      return sb - sa || byId(a.candidate.companyId, b.candidate.companyId);
    }
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return byId(a.candidate.companyId, b.candidate.companyId);
  });
  const ranked = kept.map(({ candidate, result }, index): RankedCandidate => ({
    companyId: candidate.companyId,
    rank: index + 1,
    internalScore: result.score,
    scored: result.score !== null,
    rankerId: RANKER_ID,
    rankerVersion: RANKER_VERSION,
    rankingConfigVersion: config.version,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    featureSnapshot: {
      fingerprint: candidate.snapshot.fingerprint,
      mandateVersion: candidate.snapshot.mandateVersion,
      companyProjectionVersion: candidate.snapshot.companyProjectionVersion,
    },
    candidateProvenance: candidate.snapshot.candidateProvenance,
    factors: [...result.factors],
    reasonCodes: [...result.reasonCodes],
    diagnostics: result.diagnostics,
  }));
  return { ranked, belowThreshold: scoredAll.length - kept.length };
}

/** A ranker bound to one config, validated against the registry at construction. */
export function createDeterministicRanker(options: {
  readonly config: RankingConfig;
  readonly registry: FeatureRegistry;
}): Ranker {
  const { config, registry } = options;
  validateRankingConfig(config, registry);
  return {
    id: RANKER_ID,
    version: RANKER_VERSION,
    configVersion: config.version,
    rank: (context, candidates) =>
      Promise.resolve(
        rankSnapshots(config, registry, context, candidates).ranked,
      ),
  };
}
