import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { STRUCTURED_GENERATOR_VERSION } from "../src/candidates/contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  type RecommendationContext,
} from "../src/eligibility/contracts.js";
import { SEMANTIC_GENERATOR_VERSION } from "../src/semantic/contracts.js";
import type { MandateSnapshotForEligibility } from "../src/eligibility/ports.js";
import {
  FEATURE_SCHEMA_VERSION,
  RECOMMENDATION_FEATURES,
  RecommendationFeatureDefinitionSchema,
  type RecommendationFeatureSnapshot,
} from "../src/features/contracts.js";
import {
  computeFeatureValues,
  createFeatureRegistry,
  snapshotFingerprint,
  snapshotSensitivity,
  toSnapshotCandidateProvenance,
  type FeatureInputs,
} from "../src/features/policy.js";
import type { FeatureService } from "../src/features/service.js";
import {
  RANKING_CONFIG_V1,
  RANKING_CONFIGS,
  RankingConfigError,
  RankingConfigSchema,
  validateRankingConfig,
  validateRankingConfigs,
  type RankingConfig,
} from "../src/ranking/config.js";
import {
  RANKER_ID,
  RANKER_VERSION,
  RankedCandidateSchema,
  RankingInputError,
  type RankedCandidate,
} from "../src/ranking/contracts.js";
import {
  createDeterministicRanker,
  normalizeFactorValue,
  rankSnapshots,
  type EnrichedCandidate,
  type RankingContext,
} from "../src/ranking/ranker.js";
import { createRankingService } from "../src/ranking/service.js";

/**
 * The deterministic V1 ranker (CQ-REC-005 §92–§93, golden A–R, GM-01..04).
 * Every snapshot here is built by the real REC-004 policy from typed
 * projections, with a real fingerprint, so the ranker is exercised on
 * exactly what the feature service produces. The fixture companies carry
 * the things that must not matter — views, impressions, revenue, evidence
 * counts, founder-private notes — in fields no projection reads.
 */

const TENANT_I = "11111111-0000-4000-8000-000000000011";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const TENANT_C = "22222222-0000-4000-8000-000000000021";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const PAYMENTS = "44444444-0000-4000-8000-000000000042";
const FINTECH = "44444444-0000-4000-8000-000000000041";
const SOCIAL = "44444444-0000-4000-8000-000000000049";
const WEST_AFRICA = "44444444-0000-4000-8000-000000000046";
const MARKER = "REC005_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_RANKING";

const companyId = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

const registry = createFeatureRegistry();
const DEFINITIONS = registry.featuresFor("INVESTOR_DISCOVER");

/** GM-01's investor: seed; Nigeria / Ghana / Kenya; B2B payments infrastructure; $250K–$1M. */
function gmMandate(
  overrides: Partial<MandateSnapshotForEligibility> = {},
): MandateSnapshotForEligibility {
  return {
    mandateId: MANDATE,
    investorOrganisationId: INVESTOR,
    version: 1,
    status: "ACTIVE",
    constraints: [
      {
        dimension: "stage",
        operator: "IN",
        value: { kind: "codes", values: ["seed"] },
        importance: "MUST",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
      {
        dimension: "geography.country",
        operator: "IN",
        value: { kind: "codes", values: ["NG", "GH", "KE"] },
        importance: "STRONG",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
      {
        dimension: "cheque.typical",
        operator: "BETWEEN",
        value: { kind: "amount", amount: "250000", currency: "USD" },
        importance: "NICE",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
    ],
    taxonomyPreferences: [
      {
        nodeId: PAYMENTS,
        vocabularyCode: "industry",
        preferenceStrength: "STRONG",
        isExclusion: false,
        source: "user_selected",
      },
    ],
    ...overrides,
  };
}

const CONTEXT: RecommendationContext = {
  tenantId: TENANT_I,
  investorOrganisationId: INVESTOR,
  mode: "INVESTOR_DISCOVER",
  mandateId: MANDATE,
  taxonomyVersion: { industry: 1, geography: 1 },
  eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
};
const RANKING_CONTEXT: RankingContext = {
  recommendation: CONTEXT,
  mandateVersion: 1,
};

type Company = {
  n: number;
  stage: string | null;
  country: string | null;
  nodes: { nodeId: string; vocabularyCode: string; source: string }[];
  semantic: number | null;
  structured: boolean;
  // Never read by any projection; present to prove it.
  views?: number;
  impressions?: number;
  revenueUsd?: number;
  evidenceDocuments?: number;
  founderPrivate?: string[];
  browsedByInvestor?: string[];
  gateqRule?: string;
};

function snapshotFor(
  c: Company,
  options: {
    readonly mandate?: MandateSnapshotForEligibility;
    readonly definitions?: typeof DEFINITIONS;
    readonly context?: RecommendationContext;
  } = {},
): RecommendationFeatureSnapshot {
  const mandate = options.mandate ?? gmMandate();
  const definitions = options.definitions ?? DEFINITIONS;
  const inputs: FeatureInputs = {
    mandate: { ...mandate, sourceClass: "DECLARED_MANDATE" },
    company: {
      sourceClass: "CANONICAL_COMPANY_STATE",
      companyId: companyId(c.n),
      tenantId: TENANT_C,
      currentStageCode: c.stage,
      headquartersCountry: c.country,
      version: 1,
    },
    taxonomy: { sourceClass: "CANONICAL_TAXONOMY", classifications: c.nodes },
    hierarchy: {
      sourceClass: "TAXONOMY_REFERENCE_HIERARCHY",
      nodes: [
        {
          preferredNodeId: PAYMENTS,
          vocabularyCode: "industry",
          unrestricted: false,
          descendantNodeIds: [],
        },
      ],
    },
    candidate: {
      structured: c.structured
        ? {
            sourceClass: "STRUCTURED_CANDIDATE_PROVENANCE",
            generatorVersion: STRUCTURED_GENERATOR_VERSION,
            reasonCodes: ["STAGE_OVERLAP"],
          }
        : null,
      semantic:
        c.semantic === null
          ? null
          : {
              sourceClass: "SEMANTIC_CANDIDATE_PROVENANCE",
              generatorVersion: SEMANTIC_GENERATOR_VERSION,
              companyRepresentationVersion:
                "company-investment-representation.v1",
              investorRepresentationVersion:
                "investor-mandate-representation.v1",
              configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
              similarity: c.semantic,
            },
    },
    eligibility: {
      sourceClass: "ELIGIBILITY_RESULT",
      decision: "ELIGIBLE",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
    },
  };
  const { values } = computeFeatureValues(definitions, inputs);
  const context = options.context ?? CONTEXT;
  const body = {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    context,
    mandateId: mandate.mandateId,
    mandateVersion: mandate.version,
    companyId: companyId(c.n),
    companyTenantId: TENANT_C,
    companyProjectionVersion: 1,
    eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
    eligibilityDecision: "ELIGIBLE" as const,
    candidateProvenance: toSnapshotCandidateProvenance(inputs.candidate),
    sensitivity: snapshotSensitivity(values),
    features: [...values],
  };
  return {
    ...body,
    fingerprint: snapshotFingerprint({ definitions, snapshot: body }),
    computedAt: "2026-09-18T12:00:00.000Z",
  };
}

const enrich = (s: RecommendationFeatureSnapshot): EnrichedCandidate => ({
  companyId: s.companyId,
  snapshot: s,
});
const rank = (
  companies: readonly Company[],
  config: RankingConfig = RANKING_CONFIG_V1,
) =>
  rankSnapshots(
    config,
    registry,
    RANKING_CONTEXT,
    companies.map((c) => enrich(snapshotFor(c))),
  ).ranked;
const order = (ranked: readonly RankedCandidate[]) =>
  ranked.map((r) => r.companyId);
const byN = (ranked: readonly RankedCandidate[], n: number) => {
  const r = ranked.find((x) => x.companyId === companyId(n));
  if (r === undefined) throw new Error(`no candidate ${String(n)}`);
  return r;
};

/** A: exact declared fit, strong semantic. */
const EXACT: Company = {
  n: 1,
  stage: "seed",
  country: "NG",
  nodes: [
    { nodeId: PAYMENTS, vocabularyCode: "industry", source: "user_selected" },
  ],
  semantic: 0.734,
  structured: true,
};

describe("ranking-config.v1", () => {
  it("is valid against the registry, frozen, uncalibrated and accounts for every registered feature", () => {
    expect(() =>
      validateRankingConfigs(RANKING_CONFIGS, registry),
    ).not.toThrow();
    expect(Object.isFrozen(RANKING_CONFIG_V1)).toBe(true);
    expect(Object.isFrozen(RANKING_CONFIG_V1.factors[0]?.normalization)).toBe(
      true,
    );
    expect(RANKING_CONFIG_V1.status).toBe("INITIAL_HEURISTIC_UNCALIBRATED");
    expect(RANKING_CONFIG_V1.thresholds.minimumFit).toBeNull();
    expect(RANKING_CONFIG_V1.exploration).toEqual({ mode: "NONE", rate: 0 });
    const accounted = [
      ...RANKING_CONFIG_V1.factors.map((f) => f.featureId),
      ...RANKING_CONFIG_V1.inactiveFeatures.map((f) => f.featureId),
    ].sort();
    expect(accounted).toEqual(RECOMMENDATION_FEATURES.map((d) => d.id).sort());
    expect(RANKING_CONFIG_V1.inactiveFeatures).toEqual([
      {
        featureId: "eligibility.hard_gate",
        featureVersion: "v1",
        role: "GATE_ONLY",
      },
      {
        featureId: "declared_fit.cheque",
        featureVersion: "v1",
        role: "NOT_COMPUTABLE",
      },
    ]);
    // Print the complete production config for review (§94).
    console.info(
      `[REC-005 ranking-config.v1] ${JSON.stringify(RANKING_CONFIG_V1)}`,
    );
  });

  it("fails fast on a malformed config", () => {
    const bad = (patch: Partial<RankingConfig>) => () =>
      validateRankingConfig(
        RankingConfigSchema.parse({ ...RANKING_CONFIG_V1, ...patch }),
        registry,
      );
    expect(bad({ inactiveFeatures: [] })).toThrow(/not accounted/);
    expect(bad({ context: "GATEQ" })).toThrow(RankingConfigError);
    expect(bad({ context: "FOUNDER_DISCOVER" })).toThrow(
      /no feature is allowed/,
    );
    expect(
      bad({
        factors: RANKING_CONFIG_V1.factors.map((f) => ({ ...f, weight: 0 })),
      }),
    ).toThrow(/positive weight/);
    const stage = RANKING_CONFIG_V1.factors[0];
    if (stage === undefined) throw new Error("fixture");
    expect(
      bad({
        factors: [
          ...RANKING_CONFIG_V1.factors,
          { ...stage, featureId: "behavior.profile_views" },
        ],
      }),
    ).toThrow(/not a registered feature/);
    if (stage.normalization.kind !== "CATEGORY_MAP") throw new Error("fixture");
    expect(
      bad({
        factors: [
          {
            ...stage,
            normalization: {
              kind: "CATEGORY_MAP",
              map: {
                MATCH: {
                  value: 1,
                  polarity: "POSITIVE",
                  reasonCode: "STAGE_ALIGNED",
                },
              },
            },
          },
          ...RANKING_CONFIG_V1.factors.slice(1),
        ],
      }),
    ).toThrow(/cover exactly/);
    expect(() =>
      RankingConfigSchema.parse({
        ...RANKING_CONFIG_V1,
        factors: [{ ...stage, weight: -1 }],
      }),
    ).toThrow();
    expect(() =>
      RankingConfigSchema.parse({
        ...RANKING_CONFIG_V1,
        factors: [{ ...stage, weight: Number.NaN }],
      }),
    ).toThrow();
    expect(() =>
      validateRankingConfigs([RANKING_CONFIG_V1, RANKING_CONFIG_V1], registry),
    ).toThrow(/unique/);
  });

  it("a changed feature version requires a new config: v1 mappings refuse a registry that moved stage to v2 (§11)", () => {
    const moved = createFeatureRegistry(
      RECOMMENDATION_FEATURES.map((d) =>
        d.id === "declared_fit.stage"
          ? RecommendationFeatureDefinitionSchema.parse({ ...d, version: "v2" })
          : d,
      ),
    );
    expect(() => validateRankingConfig(RANKING_CONFIG_V1, moved)).toThrow(
      /registered at v2, not v1/,
    );
    expect(() =>
      createDeterministicRanker({ config: RANKING_CONFIG_V1, registry: moved }),
    ).toThrow(RankingConfigError);
  });
});

describe("normalization (§19–§23, §71–§72)", () => {
  const factor = (id: string) => {
    const f = RANKING_CONFIG_V1.factors.find((x) => x.featureId === id);
    if (f === undefined) throw new Error(id);
    return f.normalization;
  };
  const n = (id: string, v: string | number) =>
    normalizeFactorValue(factor(id), v)?.normalized;

  it("category maps are monotonic and explicit", () => {
    expect(n("declared_fit.stage", "MATCH")).toBe(1);
    expect(n("declared_fit.stage", "NO_MATCH")).toBe(0);
    expect(n("declared_fit.geography", "COUNTRY_MATCH")).toBe(1);
    expect(n("declared_fit.geography", "REGION_MATCH")).toBe(0.75);
    expect(n("declared_fit.geography", "NO_MATCH")).toBe(0);
    expect(n("declared_fit.taxonomy", "EXACT_OVERLAP")).toBe(1);
    expect(n("declared_fit.taxonomy", "DESCENDANT_OVERLAP")).toBe(0.75);
    expect(n("declared_fit.taxonomy", "NO_OVERLAP")).toBe(0);
    expect(
      normalizeFactorValue(factor("declared_fit.stage"), "PERFECT"),
    ).toBeNull();
  });

  it("semantic similarity maps linearly onto [0, 1], bounded, monotonic, finite", () => {
    const s = (v: number) =>
      n("semantic_fit.mandate_similarity", v) ?? Number.NaN;
    expect(s(-1)).toBe(0);
    expect(s(0)).toBe(0.5);
    expect(s(1)).toBe(1);
    const real = [0.334, 0.542, 0.734, 0.937].map(s);
    const expected = [0.667, 0.771, 0.867, 0.9685];
    for (const [i, value] of real.entries()) {
      expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 12);
    }
    for (let i = 1; i < real.length; i += 1)
      expect(real[i]).toBeGreaterThan(real[i - 1] ?? 1);
    expect(s(5)).toBe(1);
    expect(s(-5)).toBe(0);
  });
});

describe("scoring and ordering", () => {
  it("A/B: exact declared fit ranks first; a missing semantic factor is excluded, not zero, and the arithmetic says so (§24–§25, §67)", () => {
    const withoutSemantic: Company = { ...EXACT, n: 2, semantic: null };
    const weaker: Company = {
      n: 3,
      stage: "seed",
      country: "DE",
      nodes: [
        { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
      ],
      semantic: 0.2,
      structured: true,
    };
    const ranked = rank([weaker, withoutSemantic, EXACT]);
    for (const r of ranked) expect(RankedCandidateSchema.parse(r)).toEqual(r);
    // B has every declared factor aligned and no semantic factor: 3/3 = 1.
    const b = byN(ranked, 2);
    expect(b.internalScore).toBe(1);
    expect(b.diagnostics).toMatchObject({
      configuredWeight: 4,
      availableWeight: 3,
      presentFactorCount: 3,
      missingFactorCount: 1,
      factorCoverage: 0.75,
    });
    const semanticFactor = b.factors.find(
      (f) => f.featureId === "semantic_fit.mandate_similarity",
    );
    expect(semanticFactor).toMatchObject({
      outcome: "MISSING",
      normalizedValue: null,
      contribution: null,
      reasonCode: "FACTOR_MISSING",
      missingReason: "SEMANTIC_NOT_RETRIEVED",
    });
    // A: (1 + 1 + 1 + 0.867) / 4
    const a = byN(ranked, 1);
    expect(a.internalScore).toBeCloseTo((3 + 0.867) / 4, 12);
    expect(order(ranked)).toEqual([companyId(2), companyId(1), companyId(3)]);
    expect(a.reasonCodes).toEqual([
      "STAGE_ALIGNED",
      "GEOGRAPHY_COUNTRY_ALIGNED",
      "TAXONOMY_EXACT",
      "SEMANTIC_SIMILARITY_PRESENT",
    ]);
  });

  it("every contribution is a configured factor and the contributions reconcile to the score (§30, §76–§77)", () => {
    const pool: Company[] = [
      EXACT,
      {
        n: 4,
        stage: "series_a",
        country: "GH",
        nodes: [
          {
            nodeId: FINTECH,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
        semantic: 0.542,
        structured: true,
      },
      {
        n: 5,
        stage: null,
        country: "KE",
        nodes: [],
        semantic: -0.2,
        structured: false,
      },
    ];
    const configured = new Set(
      RANKING_CONFIG_V1.factors.map((f) => f.featureId),
    );
    const registered = new Set(RECOMMENDATION_FEATURES.map((d) => d.id));
    for (const r of rank(pool)) {
      expect(r.factors.map((f) => f.featureId)).toEqual(
        RANKING_CONFIG_V1.factors.map((f) => f.featureId),
      );
      for (const f of r.factors) {
        expect(configured.has(f.featureId)).toBe(true);
        expect(registered.has(f.featureId)).toBe(true);
        expect(Object.keys(f).sort()).toEqual([
          "configuredWeight",
          "contribution",
          "featureId",
          "featureStatus",
          "featureValue",
          "featureVersion",
          "group",
          "missingReason",
          "normalizedValue",
          "outcome",
          "polarity",
          "reasonCode",
          "sourceClasses",
        ]);
      }
      if (r.internalScore === null) continue;
      const sum = r.factors.reduce((s, f) => s + (f.contribution ?? 0), 0);
      expect(Math.abs(sum - r.internalScore)).toBeLessThan(1e-9);
      const available = r.factors
        .filter((f) => f.outcome === "SCORED")
        .reduce((s, f) => s + f.configuredWeight, 0);
      expect(available).toBe(r.diagnostics.availableWeight);
      for (const f of r.factors.filter((x) => x.outcome === "SCORED")) {
        expect(f.contribution).toBeCloseTo(
          ((f.normalizedValue ?? 0) * f.configuredWeight) / available,
          12,
        );
      }
      expect(r.internalScore).toBeGreaterThanOrEqual(0);
      expect(r.internalScore).toBeLessThanOrEqual(1);
    }
  });

  it("C: a semantic-only candidate with declared fit unknown is scored from what is present, with low coverage and no hidden penalty (§68)", () => {
    const semanticOnly: Company = {
      n: 6,
      stage: null,
      country: null,
      nodes: [],
      semantic: 0.937,
      structured: false,
    };
    const r = byN(rank([semanticOnly]), 6);
    expect(r.scored).toBe(true);
    expect(r.internalScore).toBeCloseTo(0.9685, 12);
    expect(r.diagnostics).toMatchObject({
      presentFactorCount: 1,
      missingFactorCount: 3,
      factorCoverage: 0.25,
    });
    expect(r.candidateProvenance.structured).toBeNull();
  });

  it("D: a structured-only candidate is scored from structured fit; no semantic zero (§69)", () => {
    const r = byN(rank([{ ...EXACT, n: 7, semantic: null }]), 7);
    expect(r.internalScore).toBe(1);
    expect(
      r.factors.find((f) => f.featureId === "semantic_fit.mandate_similarity")
        ?.outcome,
    ).toBe("MISSING");
  });

  it("E: multiple known soft no-matches rank below a stronger available fit", () => {
    const mismatched: Company = {
      n: 8,
      stage: "series_b",
      country: "DE",
      nodes: [
        { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
      ],
      semantic: 0.1,
      structured: true,
    };
    const ranked = rank([mismatched, EXACT]);
    expect(order(ranked)).toEqual([companyId(1), companyId(8)]);
    const m = byN(ranked, 8);
    expect(m.reasonCodes).toEqual([
      "STAGE_MISMATCH",
      "GEOGRAPHY_MISMATCH",
      "TAXONOMY_MISMATCH",
      "SEMANTIC_SIMILARITY_PRESENT",
    ]);
    expect(
      m.factors.filter((f) => f.polarity === "SOFT_MISMATCH"),
    ).toHaveLength(3);
  });

  it("F: all scoreable factors missing is UNSCORED, not zero, and sorts after every scored candidate by company id (§26, §70)", () => {
    const blank = (n: number): Company => ({
      n,
      stage: null,
      country: null,
      nodes: [],
      semantic: null,
      structured: true,
    });
    const zeroFit: Company = {
      n: 9,
      stage: "series_b",
      country: "DE",
      nodes: [
        { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
      ],
      semantic: -1,
      structured: true,
    };
    const ranked = rank([blank(12), zeroFit, blank(10), EXACT]);
    expect(order(ranked)).toEqual([
      companyId(1),
      companyId(9),
      companyId(10),
      companyId(12),
    ]);
    expect(byN(ranked, 9).internalScore).toBe(0);
    for (const n of [10, 12]) {
      const r = byN(ranked, n);
      expect(r).toMatchObject({ internalScore: null, scored: false });
      expect(r.reasonCodes).toEqual(["NO_SCOREABLE_FEATURES"]);
      expect(r.diagnostics).toMatchObject({
        availableWeight: 0,
        presentFactorCount: 0,
        missingFactorCount: 4,
      });
      expect(r.factors.every((f) => f.contribution === null)).toBe(true);
    }
  });

  it("M/N: repeated input gives identical output; equal scores fall back to canonical company id, whatever the input order (§39–§40, §75)", () => {
    const twinA: Company = { ...EXACT, n: 21 };
    const twinB: Company = { ...EXACT, n: 20 };
    const first = rank([twinA, twinB, EXACT]);
    expect(order(first)).toEqual([companyId(1), companyId(20), companyId(21)]);
    for (let i = 0; i < 50; i += 1) {
      const shuffled =
        i % 2 === 0 ? [twinB, EXACT, twinA] : [EXACT, twinA, twinB];
      expect(rank(shuffled)).toEqual(first);
    }
  });

  it("the score reads no clock: computedAt changes nothing", () => {
    const s = snapshotFor(EXACT);
    const later = { ...s, computedAt: "2031-01-01T00:00:00.000Z" };
    const a = rankSnapshots(RANKING_CONFIG_V1, registry, RANKING_CONTEXT, [
      enrich(s),
    ]).ranked;
    const b = rankSnapshots(RANKING_CONFIG_V1, registry, RANKING_CONTEXT, [
      enrich(later),
    ]).ranked;
    expect(b).toEqual(a);
  });

  it("weights are configuration: a test config changes the score as its weights say, and results record which config (§73–§74)", () => {
    const testV2 = RankingConfigSchema.parse({
      ...RANKING_CONFIG_V1,
      version: "ranking-config.test-v2",
      factors: RANKING_CONFIG_V1.factors.map((f) => ({
        ...f,
        weight: f.featureId === "declared_fit.stage" ? 3 : 1,
      })),
    });
    validateRankingConfig(testV2, registry);
    const c: Company = {
      n: 30,
      stage: "seed",
      country: "DE",
      nodes: [
        { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
      ],
      semantic: null,
      structured: true,
    };
    const v1 = byN(rank([c]), 30);
    const v2 = byN(rank([c], testV2), 30);
    expect(v1.internalScore).toBeCloseTo(1 / 3, 12);
    expect(v2.internalScore).toBeCloseTo(3 / 5, 12);
    expect(v1.rankingConfigVersion).toBe("ranking-config.v1");
    expect(v2.rankingConfigVersion).toBe("ranking-config.test-v2");
    expect(RANKING_CONFIG_V1.factors.every((f) => f.weight === 1)).toBe(true);
    expect(byN(rank([c]), 30)).toEqual(v1);
  });

  it("a minimum-fit threshold only acts when a config sets one; v1 sets none (§62)", () => {
    const weak: Company = {
      n: 31,
      stage: "series_b",
      country: "DE",
      nodes: [
        { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
      ],
      semantic: null,
      structured: true,
    };
    expect(rank([weak, EXACT])).toHaveLength(2);
    const gated = RankingConfigSchema.parse({
      ...RANKING_CONFIG_V1,
      version: "ranking-config.test-threshold",
      thresholds: { minimumFit: 0.5 },
    });
    const out = rankSnapshots(
      gated,
      registry,
      RANKING_CONTEXT,
      [weak, EXACT].map((c) => enrich(snapshotFor(c))),
    );
    expect(order(out.ranked)).toEqual([companyId(1)]);
    expect(out.belowThreshold).toBe(1);
  });

  it("carries identity, versions, the snapshot reference and both provenances; no raw text", () => {
    const [r] = rank([EXACT]);
    expect(r).toMatchObject({
      rank: 1,
      rankerId: RANKER_ID,
      rankerVersion: RANKER_VERSION,
      rankingConfigVersion: "ranking-config.v1",
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      featureSnapshot: {
        fingerprint: snapshotFor(EXACT).fingerprint,
        mandateVersion: 1,
        companyProjectionVersion: 1,
      },
      candidateProvenance: {
        structured: { generatorVersion: STRUCTURED_GENERATOR_VERSION },
        semantic: { generatorVersion: SEMANTIC_GENERATOR_VERSION },
      },
    });
    expect(JSON.stringify(r)).not.toMatch(
      /probability|percent|matchScore|investiq|quality/i,
    );
  });
});

describe("golden matching scenarios (doc 19 §179–§180)", () => {
  const A = EXACT;
  const B: Company = {
    n: 41,
    stage: "seed",
    country: "NG",
    nodes: [
      { nodeId: SOCIAL, vocabularyCode: "industry", source: "user_selected" },
    ],
    semantic: 0.12,
    structured: true,
  };
  const C: Company = {
    n: 42,
    stage: "series_b",
    country: "KE",
    nodes: [
      { nodeId: FINTECH, vocabularyCode: "industry", source: "user_selected" },
    ],
    semantic: 0.5,
    structured: true,
    revenueUsd: 40_000_000,
  };
  const D: Company = { ...EXACT, n: 43, evidenceDocuments: 0 };

  it("GM-01: the exact company is the top candidate; cheque stays MISSING and is not faked", () => {
    const ranked = rank([B, C, A]);
    expect(ranked[0]?.companyId).toBe(companyId(1));
    const cheque = snapshotFor(A).features.find(
      (f) => f.featureId === "declared_fit.cheque",
    );
    expect(cheque).toMatchObject({
      status: "MISSING",
      missingReason: "CHEQUE_NOT_COMPUTABLE",
    });
    expect(
      byN(ranked, 1).factors.some((f) => f.featureId === "declared_fit.cheque"),
    ).toBe(false);
  });

  it("GM-02: an eligible consumer social app ranks below the aligned company", () => {
    const ranked = rank([B, A]);
    expect(order(ranked)).toEqual([companyId(1), companyId(41)]);
    expect(byN(ranked, 41).reasonCodes).toContain("TAXONOMY_MISMATCH");
  });

  it("GM-03: a strong business with a mandate mismatch does not outrank a better fit; revenue is not a feature", () => {
    const ranked = rank([C, A]);
    expect(order(ranked)).toEqual([companyId(1), companyId(42)]);
    const richer = rank([{ ...C, revenueUsd: 900_000_000 }, A]);
    expect(richer).toEqual(ranked);
  });

  it("GM-04: a perfect thesis with sparse evidence scores exactly like the same thesis with evidence", () => {
    const ranked = rank([D, A]);
    expect(byN(ranked, 43).internalScore).toBe(byN(ranked, 1).internalScore);
    expect(byN(ranked, 43).factors.map((f) => f.featureId)).not.toContain(
      "evidence.confidence",
    );
  });

  it("H/I/J (privacy): a founder-private churn fact, a Q memory marker and a raw public-web marker change no score, factor, reason or order", () => {
    const before = rank([A, B, C]);
    const marked = [A, B, C].map((c) => ({
      ...c,
      founderPrivate: [
        `${MARKER}: largest customer may churn`,
        `${MARKER}: Q memory`,
        `${MARKER}: raw PUBLIC_WEB article`,
      ],
    }));
    const after = rank(marked);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(MARKER);
  });

  it("O (popularity): 50× the views cannot lift a weaker fit above a stronger one", () => {
    const popular: Company = { ...B, views: 50_000, impressions: 90_000 };
    const quiet: Company = { ...A, views: 1_000 };
    expect(order(rank([popular, quiet]))).toEqual([
      companyId(1),
      companyId(41),
    ]);
  });

  it("P (cold start): zero impressions is not a penalty", () => {
    expect(rank([{ ...A, impressions: 0, views: 0 }])).toEqual(
      rank([{ ...A, impressions: 12_000, views: 4_000 }]),
    );
  });

  it("mandate drift: browsing logistics does not rewrite a declared payments mandate", () => {
    const logistics: Company = {
      n: 44,
      stage: "seed",
      country: "NG",
      nodes: [
        {
          nodeId: WEST_AFRICA,
          vocabularyCode: "geography",
          source: "user_selected",
        },
      ],
      semantic: 0.3,
      structured: true,
    };
    const before = rank([logistics, A]);
    const after = rank([
      {
        ...logistics,
        browsedByInvestor: ["logistics", "logistics", "logistics"],
      },
      A,
    ]);
    expect(after).toEqual(before);
    expect(after[0]?.companyId).toBe(companyId(1));
  });

  it("Q (GateQ): GateQ rule text on a company changes nothing", () => {
    expect(
      rank([{ ...A, gateqRule: "only founders with prior exits" }, B]),
    ).toEqual(rank([A, B]));
  });
});

describe("input refusal (§92 A–L)", () => {
  const good = snapshotFor(EXACT);
  const refuse = (
    s: RecommendationFeatureSnapshot,
    context: RankingContext = RANKING_CONTEXT,
  ) => {
    try {
      rankSnapshots(RANKING_CONFIG_V1, registry, context, [enrich(s)]);
    } catch (error: unknown) {
      if (error instanceof RankingInputError) return error.code;
      throw error;
    }
    return "ACCEPTED";
  };
  const refingerprint = (
    s: Omit<RecommendationFeatureSnapshot, "fingerprint">,
  ): RecommendationFeatureSnapshot => {
    const { computedAt, ...body } = s;
    return {
      ...body,
      computedAt,
      fingerprint: snapshotFingerprint({
        definitions: DEFINITIONS,
        snapshot: body,
      }),
    };
  };

  it("accepts the governed snapshot", () => {
    expect(refuse(good)).toBe("ACCEPTED");
  });

  it("A/B/C/D: another tenant, investor, mandate, mandate version or context is refused", () => {
    expect(
      refuse(good, {
        ...RANKING_CONTEXT,
        recommendation: {
          ...CONTEXT,
          tenantId: "99999999-0000-4000-8000-000000000001",
        },
      }),
    ).toBe("TENANT_MISMATCH");
    expect(
      refuse(good, {
        ...RANKING_CONTEXT,
        recommendation: {
          ...CONTEXT,
          investorOrganisationId: "99999999-0000-4000-8000-000000000002",
        },
      }),
    ).toBe("INVESTOR_MISMATCH");
    expect(
      refuse(good, {
        ...RANKING_CONTEXT,
        recommendation: {
          ...CONTEXT,
          mandateId: "99999999-0000-4000-8000-000000000003",
        },
      }),
    ).toBe("MANDATE_MISMATCH");
    expect(refuse(good, { ...RANKING_CONTEXT, mandateVersion: 2 })).toBe(
      "MANDATE_VERSION_MISMATCH",
    );
    expect(
      refuse(good, {
        ...RANKING_CONTEXT,
        recommendation: { ...CONTEXT, mode: "FOUNDER_DISCOVER" },
      }),
    ).toBe("CONTEXT_NOT_SUPPORTED");
    expect(
      refuse(good, {
        ...RANKING_CONTEXT,
        recommendation: { ...CONTEXT, mode: "GATEQ" },
      }),
    ).toBe("CONTEXT_NOT_SUPPORTED");
    expect(
      refuse(
        refingerprint({
          ...good,
          context: { ...good.context, mode: "SEARCH" },
        }),
      ),
    ).toBe("CONTEXT_MISMATCH");
  });

  it("a snapshot for another company and a duplicate company are refused", () => {
    expect(() =>
      rankSnapshots(RANKING_CONFIG_V1, registry, RANKING_CONTEXT, [
        { companyId: companyId(99), snapshot: good },
      ]),
    ).toThrow(/COMPANY_MISMATCH/);
    expect(() =>
      rankSnapshots(RANKING_CONFIG_V1, registry, RANKING_CONTEXT, [
        enrich(good),
        enrich(good),
      ]),
    ).toThrow(/DUPLICATE_COMPANY/);
  });

  it("E/F: a schema or feature-version mismatch is refused, never ranked on assumed semantics", () => {
    expect(
      refuse({
        ...good,
        featureSchemaVersion: "recommendation-features.v2",
      } as unknown as RecommendationFeatureSnapshot),
    ).toBe("FEATURE_SCHEMA_MISMATCH");
    const v2 = good.features.map((f) =>
      f.featureId === "declared_fit.stage" ? { ...f, featureVersion: "v2" } : f,
    );
    expect(refuse(refingerprint({ ...good, features: v2 }))).toBe(
      "SNAPSHOT_INVALID",
    );
  });

  it("G/H/L: an unregistered, other-context or GateQ feature cannot contribute; the snapshot is refused", () => {
    const extra = (featureId: string) =>
      refingerprint({
        ...good,
        features: [
          ...good.features,
          {
            featureId,
            featureVersion: "v1",
            status: "PRESENT",
            value: 1,
            missingReason: null,
            sourceClasses: ["DECLARED_MANDATE"],
            sensitivity: "CONFIDENTIAL",
            provenance: {},
          },
        ],
      });
    expect(refuse(extra("behavior.profile_views"))).toBe("FEATURE_NOT_ALLOWED");
    expect(refuse(extra("gateq.inbound_rule"))).toBe("FEATURE_NOT_ALLOWED");
    const gateqOnly = createFeatureRegistry([
      ...RECOMMENDATION_FEATURES,
      RecommendationFeatureDefinitionSchema.parse({
        ...RECOMMENDATION_FEATURES[1],
        id: "gateq.founder_prior_exit",
        allowedContexts: ["GATEQ"],
      }),
    ]);
    expect(() =>
      rankSnapshots(RANKING_CONFIG_V1, gateqOnly, RANKING_CONTEXT, [
        enrich(extra("gateq.founder_prior_exit")),
      ]),
    ).toThrow(/FEATURE_NOT_ALLOWED/);
  });

  it("G (eligibility): an ineligible snapshot or a false gate is refused, never scored low", () => {
    expect(
      refuse(refingerprint({ ...good, eligibilityDecision: "INELIGIBLE" })),
    ).toBe("NOT_ELIGIBLE");
    expect(
      refuse(refingerprint({ ...good, eligibilityDecision: "UNDETERMINED" })),
    ).toBe("NOT_ELIGIBLE");
    const gateFalse = good.features.map((f) =>
      f.featureId === "eligibility.hard_gate" ? { ...f, value: false } : f,
    );
    expect(refuse(refingerprint({ ...good, features: gateFalse }))).toBe(
      "NOT_ELIGIBLE",
    );
  });

  it("a snapshot computed under a superseded eligibility policy or candidate generator is refused, even with a self-consistent fingerprint", () => {
    expect(ELIGIBILITY_POLICY_VERSION).toBe("eligibility.v2");
    expect(STRUCTURED_GENERATOR_VERSION).toBe("structured-mandate.v2");
    const staleEligibility = refingerprint({
      ...good,
      eligibilityPolicyVersion: "eligibility.v1",
      context: { ...good.context, eligibilityPolicyVersion: "eligibility.v1" },
    } as unknown as Omit<RecommendationFeatureSnapshot, "fingerprint">);
    expect(
      refuse(staleEligibility, {
        ...RANKING_CONTEXT,
        recommendation: {
          ...CONTEXT,
          eligibilityPolicyVersion: "eligibility.v1",
        } as unknown as RecommendationContext,
      }),
    ).toBe("ELIGIBILITY_POLICY_MISMATCH");
    const staleGenerator = refingerprint({
      ...good,
      candidateProvenance: {
        ...good.candidateProvenance,
        structured: {
          generatorVersion: "structured-mandate.v1",
          reasonCodes: ["STAGE_OVERLAP"],
        },
      },
    } as unknown as Omit<RecommendationFeatureSnapshot, "fingerprint">);
    expect(refuse(staleGenerator)).toBe("CANDIDATE_VERSION_MISMATCH");
  });

  it("K: a tampered value (a client-supplied score or feature) no longer matches its fingerprint and is refused", () => {
    const boosted = good.features.map((f) =>
      f.featureId === "semantic_fit.mandate_similarity"
        ? { ...f, value: 1 }
        : f,
    );
    expect(refuse({ ...good, features: boosted })).toBe("FINGERPRINT_MISMATCH");
    const flipped = good.features.map((f) =>
      f.featureId === "declared_fit.stage" ? { ...f, value: "MATCH" } : f,
    );
    const weak = snapshotFor({ ...EXACT, stage: "series_b" });
    expect(
      refuse({
        ...weak,
        features: weak.features.map((f, i) => flipped[i] ?? f),
      }),
    ).toBe("FINGERPRINT_MISMATCH");
  });
});

describe("ranking service", () => {
  const ACTOR = {
    userId: "u",
    tenantId: TENANT_I,
    organisationId: "o",
    membershipId: "m",
    actorType: "HUMAN",
  } as unknown as ActorContext;

  function features(
    snapshots: readonly RecommendationFeatureSnapshot[],
    kind: "COMPUTED" | "NO_ACTIVE_MANDATE" = "COMPUTED",
  ): FeatureService & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      computeForCandidates: (query) => {
        calls.push(query);
        if (kind === "NO_ACTIVE_MANDATE") return Promise.resolve({ kind });
        return Promise.resolve({
          kind,
          snapshots,
          diagnostics: {
            featureSchemaVersion: FEATURE_SCHEMA_VERSION,
            candidates: snapshots.length,
            withoutProjection: 0,
            featureValues: snapshots.length * 6,
            present: 0,
            missing: 0,
            notApplicable: 0,
            scopeViolations: 0,
            reused: 0,
            superseded: 0,
            inserted: 0,
            queries: 6,
            computeDurationMs: 1,
            persistDurationMs: 1,
          },
        });
      },
    };
  }

  it("ranks the pool the feature service returns, bound to the server's config; a caller cannot choose weights or a score (J/K)", async () => {
    const pool = [
      snapshotFor(EXACT),
      snapshotFor({ ...EXACT, n: 50, stage: "series_b" }),
    ];
    const ranker = createDeterministicRanker({
      config: RANKING_CONFIG_V1,
      registry,
    });
    const service = createRankingService({ features: features(pool), ranker });
    const result = await service.rankCandidates({
      actor: ACTOR,
      mode: "INVESTOR_DISCOVER",
      candidates: [],
      ...({
        weights: { "declared_fit.stage": 100 },
        rankingConfigVersion: "ranking-config.test-v2",
        internalScore: 1,
      } as object),
    });
    if (result.kind !== "RANKED") throw new Error(result.kind);
    expect(result.diagnostics).toMatchObject({
      rankerId: "DETERMINISTIC",
      rankerVersion: "deterministic-ranker.v1",
      rankingConfigVersion: "ranking-config.v1",
      candidates: 2,
      scored: 2,
      unscored: 0,
    });
    expect(result.ranked.map((r) => r.rankingConfigVersion)).toEqual([
      "ranking-config.v1",
      "ranking-config.v1",
    ]);
    expect(result.ranked).toEqual(
      rankSnapshots(
        RANKING_CONFIG_V1,
        registry,
        RANKING_CONTEXT,
        pool.map(enrich),
      ).ranked,
    );
  });

  it("passes NO_ACTIVE_MANDATE through and ranks an empty pool to nothing", async () => {
    const ranker = createDeterministicRanker({
      config: RANKING_CONFIG_V1,
      registry,
    });
    expect(
      (
        await createRankingService({
          features: features([], "NO_ACTIVE_MANDATE"),
          ranker,
        }).rankCandidates({
          actor: ACTOR,
          mode: "INVESTOR_DISCOVER",
          candidates: [],
        })
      ).kind,
    ).toBe("NO_ACTIVE_MANDATE");
    const empty = await createRankingService({
      features: features([]),
      ranker,
    }).rankCandidates({
      actor: ACTOR,
      mode: "INVESTOR_DISCOVER",
      candidates: [],
    });
    expect(empty).toMatchObject({ kind: "RANKED", ranked: [] });
  });

  it("R: the ranker has no provider, database or model dependency; its only inputs are a config, a registry and snapshots", () => {
    const ranker = createDeterministicRanker({
      config: RANKING_CONFIG_V1,
      registry,
    });
    expect(Object.keys(ranker).sort()).toEqual([
      "configVersion",
      "id",
      "rank",
      "version",
    ]);
  });
});

describe("performance (§84)", () => {
  it("ranks 200 synthetic candidates without I/O in a few milliseconds", () => {
    const stages = ["seed", "series_a", "series_b", null];
    const countries = ["NG", "GH", "DE", null];
    const pool = Array.from({ length: 200 }, (_, i) =>
      enrich(
        snapshotFor({
          n: 1000 + i,
          stage: stages[i % 4] ?? null,
          country: countries[(i >> 2) % 4] ?? null,
          nodes:
            i % 3 === 0
              ? []
              : [
                  {
                    nodeId: i % 3 === 1 ? PAYMENTS : SOCIAL,
                    vocabularyCode: "industry",
                    source: "user_selected",
                  },
                ],
          semantic: i % 5 === 0 ? null : ((i * 37) % 200) / 100 - 1,
          structured: i % 5 !== 1,
        }),
      ),
    );
    const started = performance.now();
    const { ranked } = rankSnapshots(
      RANKING_CONFIG_V1,
      registry,
      RANKING_CONTEXT,
      pool,
    );
    const ms = performance.now() - started;
    expect(ranked).toHaveLength(200);
    expect(ranked.map((r) => r.rank)).toEqual(
      Array.from({ length: 200 }, (_, i) => i + 1),
    );
    const again = rankSnapshots(
      RANKING_CONFIG_V1,
      registry,
      RANKING_CONTEXT,
      [...pool].reverse(),
    ).ranked;
    expect(again).toEqual(ranked);
    expect(ms).toBeLessThan(2_000);
    console.info(
      `[REC-005 performance] candidates=200 featuresProcessed=${String(200 * DEFINITIONS.length)} rankMs=${ms.toFixed(2)} scored=${String(ranked.filter((r) => r.scored).length)} unscored=${String(ranked.filter((r) => !r.scored).length)} dbQueries=0 providerCalls=0`,
    );
  });
});
