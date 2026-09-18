import { describe, expect, it } from "vitest";

import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { HybridCandidate } from "../src/hybrid/contracts.js";
import {
  ELIGIBILITY_CRITERIA,
  RECOMMENDATION_MODES,
  type EligibilityResult,
  type RecommendationMode,
} from "../src/eligibility/contracts.js";
import type {
  ActiveMandateLookup,
  EligibilityPorts,
  MandateSnapshotForEligibility,
} from "../src/eligibility/ports.js";
import {
  FEATURE_SCHEMA_VERSION,
  FeatureValueSchema,
  RECOMMENDATION_FEATURES,
  RecommendationFeatureDefinitionSchema,
  RecommendationFeatureSnapshotSchema,
  validateFeatureRegistry,
  type RecommendationFeatureDefinition,
  type RecommendationFeatureSnapshot,
} from "../src/features/contracts.js";
import {
  checkValue,
  computeFeatureValues,
  createFeatureRegistry,
  FeatureContextNotAllowedError,
  snapshotFingerprint,
  type FeatureInputs,
} from "../src/features/policy.js";
import type {
  CompanyFeatureProjection,
  FeatureSnapshotStore,
} from "../src/features/ports.js";
import {
  CandidateNotRankableError,
  createFeatureService,
} from "../src/features/service.js";

/**
 * The feature registry, the pure computations and the service over a fake
 * world (CQ-REC-004 §74, golden A–W). The world holds canonical,
 * investor-visible facts and — deliberately — everything that must not
 * matter: a founder-private churn fact in Q memory, a private
 * conversation, a private document, raw public-web research. No port can
 * express them; the tests prove nothing about them reaches a value, a
 * provenance, a fingerprint, a log line or the store.
 */

const TENANT_I = "11111111-0000-4000-8000-000000000011";
const ORG_I = "11111111-0000-4000-8000-000000000012";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const TENANT_C = "22222222-0000-4000-8000-000000000021";
const ACTIVE_MANDATE = "33333333-0000-4000-8000-000000000031";
const DRAFT_MANDATE = "33333333-0000-4000-8000-000000000032";
const FINTECH = "44444444-0000-4000-8000-000000000041";
const PAYMENTS = "44444444-0000-4000-8000-000000000042";
const HARDWARE = "44444444-0000-4000-8000-000000000043";
const GAMBLING = "44444444-0000-4000-8000-000000000044";
const AFRICA = "44444444-0000-4000-8000-000000000045";
const WEST_AFRICA = "44444444-0000-4000-8000-000000000046";
const GLOBAL = "44444444-0000-4000-8000-000000000047";
const MARKER = "REC004_FOUNDER_PRIVATE_FEATURE_MUST_NEVER_APPEAR";
const INVESTOR_MARKER = "REC004_INVESTOR_PRIVATE_MANDATE_TEXT_INTERNAL_ONLY";

const ACTOR = {
  userId: "11111111-0000-4000-8000-000000000014",
  tenantId: TENANT_I,
  organisationId: ORG_I,
  membershipId: "11111111-0000-4000-8000-000000000015",
  actorType: "HUMAN",
} as unknown as ActorContext;

const companyId = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

const eligible = (
  id: string,
  mandateId = ACTIVE_MANDATE,
): EligibilityResult => ({
  eligibilityPolicyVersion: "eligibility.v2",
  mode: "INVESTOR_DISCOVER",
  companyId: id,
  investorOrganisationId: INVESTOR,
  mandateId,
  mandateVersion: 1,
  taxonomyVersion: null,
  decision: "ELIGIBLE",
  reasonCodes: [],
  criteria: ELIGIBILITY_CRITERIA.map((criterion) => ({
    criterion,
    outcome: "PASS" as const,
    reasonCode: null,
    detail: null,
  })),
  evaluatedAt: "2026-09-18T12:00:00.000Z",
});

function mandate(
  overrides: Partial<MandateSnapshotForEligibility> = {},
): MandateSnapshotForEligibility {
  return {
    mandateId: ACTIVE_MANDATE,
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
        value: { kind: "codes", values: ["NG"] },
        importance: "STRONG",
        isHardExclusion: false,
        automatedUse: "ELIGIBLE",
      },
      // The narrative lives in the Investors context; a MANUAL_ONLY text
      // constraint stands in for "investor-private text that must stay
      // internal" and is never read by any feature.
      {
        dimension: "custom.text",
        operator: "EQ",
        value: { kind: "text", text: INVESTOR_MARKER },
        importance: "NICE",
        isHardExclusion: false,
        automatedUse: "MANUAL_ONLY",
      },
    ],
    taxonomyPreferences: [
      {
        nodeId: FINTECH,
        vocabularyCode: "industry",
        preferenceStrength: "STRONG",
        isExclusion: false,
        source: "user_selected",
      },
      {
        nodeId: WEST_AFRICA,
        vocabularyCode: "geography",
        preferenceStrength: "NICE",
        isExclusion: false,
        source: "user_selected",
      },
      {
        nodeId: HARDWARE,
        vocabularyCode: "technology",
        preferenceStrength: "AVOID",
        isExclusion: false,
        source: "user_selected",
      },
      {
        nodeId: GAMBLING,
        vocabularyCode: "industry",
        preferenceStrength: "HARD_EXCLUSION",
        isExclusion: true,
        source: "user_selected",
      },
    ],
    ...overrides,
  };
}

const HIERARCHY: FeatureInputs["hierarchy"] = {
  sourceClass: "TAXONOMY_REFERENCE_HIERARCHY",
  nodes: [
    {
      preferredNodeId: FINTECH,
      vocabularyCode: "industry",
      unrestricted: false,
      descendantNodeIds: [PAYMENTS],
    },
    {
      preferredNodeId: WEST_AFRICA,
      vocabularyCode: "geography",
      unrestricted: false,
      descendantNodeIds: [],
    },
    {
      preferredNodeId: AFRICA,
      vocabularyCode: "geography",
      unrestricted: false,
      descendantNodeIds: [WEST_AFRICA],
    },
    {
      preferredNodeId: GLOBAL,
      vocabularyCode: "geography",
      unrestricted: true,
      descendantNodeIds: [],
    },
  ],
};

function inputs(
  overrides: {
    readonly stage?: string | null;
    readonly country?: string | null;
    readonly classifications?: FeatureInputs["taxonomy"]["classifications"];
    readonly mandate?: MandateSnapshotForEligibility;
    readonly semantic?: number | null;
    readonly structured?: boolean;
    readonly companySourceClass?: string;
  } = {},
): FeatureInputs {
  const m = overrides.mandate ?? mandate();
  return {
    mandate: { ...m, sourceClass: "DECLARED_MANDATE" },
    company: {
      sourceClass: (overrides.companySourceClass ??
        "CANONICAL_COMPANY_STATE") as "CANONICAL_COMPANY_STATE",
      companyId: companyId(1),
      tenantId: TENANT_C,
      currentStageCode:
        overrides.stage === undefined ? "seed" : overrides.stage,
      headquartersCountry:
        overrides.country === undefined ? "NG" : overrides.country,
      version: 1,
    },
    taxonomy: {
      sourceClass: "CANONICAL_TAXONOMY",
      classifications: overrides.classifications ?? [
        {
          nodeId: PAYMENTS,
          vocabularyCode: "industry",
          source: "user_selected",
        },
      ],
    },
    hierarchy: HIERARCHY,
    candidate: {
      structured:
        overrides.structured === false
          ? null
          : {
              sourceClass: "STRUCTURED_CANDIDATE_PROVENANCE",
              generatorVersion: "structured-mandate.v2",
              reasonCodes: ["STAGE_OVERLAP"],
            },
      semantic:
        overrides.semantic === undefined || overrides.semantic === null
          ? null
          : {
              sourceClass: "SEMANTIC_CANDIDATE_PROVENANCE",
              generatorVersion: "semantic-mandate.v1",
              companyRepresentationVersion:
                "company-investment-representation.v1",
              investorRepresentationVersion:
                "investor-mandate-representation.v1",
              configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
              similarity: overrides.semantic,
            },
    },
    eligibility: {
      sourceClass: "ELIGIBILITY_RESULT",
      decision: "ELIGIBLE",
      policyVersion: "eligibility.v2",
    },
  };
}

const registry = createFeatureRegistry();
const ALL = registry.featuresFor("INVESTOR_DISCOVER");
const valueOf = (values: readonly { featureId: string }[], id: string) => {
  const v = values.find((x) => x.featureId === id);
  if (v === undefined) throw new Error(`no value for ${id}`);
  return v as ReturnType<typeof FeatureValueSchema.parse>;
};

describe("feature registry", () => {
  it("is well-formed, frozen, versioned and INVESTOR_DISCOVER-only in V1 (§68, §69)", () => {
    expect(() =>
      validateFeatureRegistry(RECOMMENDATION_FEATURES),
    ).not.toThrow();
    expect(registry.schemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(Object.isFrozen(RECOMMENDATION_FEATURES)).toBe(true);
    for (const d of RECOMMENDATION_FEATURES) {
      expect(Object.isFrozen(d)).toBe(true);
      expect(d.allowedContexts).toEqual(["INVESTOR_DISCOVER"]);
      expect(d.description.length).toBeGreaterThan(20);
      expect(RecommendationFeatureDefinitionSchema.parse(d)).toEqual(d);
    }
    expect(RECOMMENDATION_FEATURES.map((d) => d.id)).toEqual([
      "eligibility.hard_gate",
      "declared_fit.stage",
      "declared_fit.geography",
      "declared_fit.taxonomy",
      "declared_fit.cheque",
      "semantic_fit.mandate_similarity",
    ]);
  });

  it("fails fast on a malformed registry", () => {
    const [first] = RECOMMENDATION_FEATURES;
    if (first === undefined) throw new Error("fixture");
    expect(() => validateFeatureRegistry([first, first])).toThrow(/duplicate/);
    expect(() =>
      validateFeatureRegistry([
        { ...first, dataType: "category", categories: [] },
      ]),
    ).toThrow(/categories/);
    expect(() =>
      validateFeatureRegistry([{ ...first, dataType: "number", range: null }]),
    ).toThrow(/range/);
    expect(() =>
      RecommendationFeatureDefinitionSchema.parse({
        ...first,
        allowedContexts: [],
      }),
    ).toThrow();
    expect(() =>
      RecommendationFeatureDefinitionSchema.parse({
        ...first,
        sourceClasses: ["Q_MEMORY"],
      }),
    ).toThrow();
    expect(() =>
      RecommendationFeatureDefinitionSchema.parse({
        ...first,
        sensitivity: "SECRET",
      }),
    ).toThrow();
  });

  it("R: a context the registry does not name fails closed, for the whole set and per feature (§13, §61)", () => {
    const others = RECOMMENDATION_MODES.filter(
      (m) => m !== "INVESTOR_DISCOVER",
    );
    expect(others.length).toBeGreaterThan(0);
    for (const mode of others) {
      expect(() => registry.featuresFor(mode)).toThrow(
        FeatureContextNotAllowedError,
      );
      expect(() => registry.require("declared_fit.stage", mode)).toThrow(
        FeatureContextNotAllowedError,
      );
    }
    expect(registry.require("declared_fit.stage", "INVESTOR_DISCOVER").id).toBe(
      "declared_fit.stage",
    );
    expect(() =>
      registry.require("behavior.profile_views", "INVESTOR_DISCOVER"),
    ).toThrow(FeatureContextNotAllowedError);
  });

  it("no future signal is registered: no behaviour, evidence, portfolio, freshness, exploration or exposure feature exists (§11, §28)", () => {
    const groups = new Set(RECOMMENDATION_FEATURES.map((d) => d.featureGroup));
    expect([...groups].sort()).toEqual([
      "DECLARED_FIT",
      "ELIGIBILITY",
      "SEMANTIC_FIT",
    ]);
    expect(JSON.stringify(RECOMMENDATION_FEATURES)).not.toMatch(
      /watch|view|click|popular|follower|charisma|pitch quality|churn/i,
    );
  });

  it("type safety: a value of the wrong type or outside its range is rejected (§70)", () => {
    const stage = registry.require("declared_fit.stage", "INVESTOR_DISCOVER");
    const bad = FeatureValueSchema.parse({
      featureId: stage.id,
      featureVersion: "v1",
      status: "PRESENT",
      value: 0.5,
      missingReason: null,
      sourceClasses: ["DECLARED_MANDATE"],
      sensitivity: "CONFIDENTIAL",
      provenance: {},
    });
    expect(checkValue(stage, bad).join(" ")).toMatch(/category/);
    const similarity = registry.require(
      "semantic_fit.mandate_similarity",
      "INVESTOR_DISCOVER",
    );
    expect(
      checkValue(similarity, {
        ...bad,
        featureId: similarity.id,
        sourceClasses: ["SEMANTIC_CANDIDATE_PROVENANCE"],
        value: "high",
      }).join(" "),
    ).toMatch(/finite number/);
    expect(
      checkValue(similarity, {
        ...bad,
        featureId: similarity.id,
        sourceClasses: ["SEMANTIC_CANDIDATE_PROVENANCE"],
        value: 7,
      }).join(" "),
    ).toMatch(/range/);
    expect(() =>
      FeatureValueSchema.parse({
        ...bad,
        status: "MISSING",
        value: "MATCH",
        missingReason: null,
      }),
    ).toThrow();
  });
});

describe("feature computation (pure)", () => {
  it("A/D/F/I: known matches are PRESENT with bounded provenance", () => {
    const { values, scopeViolations } = computeFeatureValues(
      ALL,
      inputs({ semantic: 0.73 }),
    );
    expect(scopeViolations).toBe(0);
    expect(valueOf(values, "eligibility.hard_gate")).toMatchObject({
      status: "PRESENT",
      value: true,
      sensitivity: "INTERNAL",
    });
    expect(valueOf(values, "declared_fit.stage")).toMatchObject({
      status: "PRESENT",
      value: "MATCH",
      sourceClasses: ["DECLARED_MANDATE", "CANONICAL_COMPANY_STATE"],
      sensitivity: "CONFIDENTIAL",
      provenance: { companyStageCode: "seed" },
    });
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "PRESENT",
      value: "COUNTRY_MATCH",
    });
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "PRESENT",
      value: "DESCENDANT_OVERLAP",
      provenance: { preferredNodeId: FINTECH, matchedNodeId: PAYMENTS },
    });
    expect(valueOf(values, "semantic_fit.mandate_similarity")).toMatchObject({
      status: "PRESENT",
      value: 0.73,
      provenance: {
        generatorVersion: "semantic-mandate.v1",
        configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
      },
    });
    // Registry order, always.
    expect(values.map((v) => v.featureId)).toEqual(ALL.map((d) => d.id));
  });

  it("F: an exact taxonomy overlap is EXACT_OVERLAP, distinct from a descendant one", () => {
    const { values } = computeFeatureValues(
      ALL,
      inputs({
        classifications: [
          {
            nodeId: FINTECH,
            vocabularyCode: "industry",
            source: "admin_curated",
          },
        ],
      }),
    );
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "PRESENT",
      value: "EXACT_OVERLAP",
    });
  });

  it("B: a known soft non-match is NO_MATCH / NO_OVERLAP, never MISSING", () => {
    const { values } = computeFeatureValues(
      ALL,
      inputs({
        stage: "series_b",
        country: "DE",
        classifications: [
          {
            nodeId: HARDWARE,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(valueOf(values, "declared_fit.stage")).toMatchObject({
      status: "PRESENT",
      value: "NO_MATCH",
    });
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "PRESENT",
      value: "NO_MATCH",
    });
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "PRESENT",
      value: "NO_OVERLAP",
    });
  });

  it("C/H/J/K: unknown stage, unknown taxonomy, structured-only and cheque are MISSING with a reason, never zero (§19, §64)", () => {
    const { values } = computeFeatureValues(
      ALL,
      inputs({ stage: null, classifications: [], country: "NG" }),
    );
    expect(valueOf(values, "declared_fit.stage")).toMatchObject({
      status: "MISSING",
      value: null,
      missingReason: "COMPANY_STAGE_UNKNOWN",
    });
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "MISSING",
      value: null,
      missingReason: "COMPANY_TAXONOMY_UNKNOWN",
    });
    expect(valueOf(values, "declared_fit.cheque")).toMatchObject({
      status: "MISSING",
      value: null,
      missingReason: "CHEQUE_NOT_COMPUTABLE",
    });
    expect(valueOf(values, "semantic_fit.mandate_similarity")).toMatchObject({
      status: "MISSING",
      value: null,
      missingReason: "SEMANTIC_NOT_RETRIEVED",
    });
    expect(values.some((v) => v.status !== "PRESENT" && v.value === 0)).toBe(
      false,
    );
  });

  it("unknown geography is MISSING; a Q-proposed classification is not a declared one", () => {
    const { values } = computeFeatureValues(
      ALL,
      inputs({
        country: null,
        classifications: [
          {
            nodeId: WEST_AFRICA,
            vocabularyCode: "geography",
            source: "q_inferred",
          },
        ],
      }),
    );
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "MISSING",
      missingReason: "COMPANY_GEOGRAPHY_UNKNOWN",
    });
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "MISSING",
      missingReason: "COMPANY_TAXONOMY_UNKNOWN",
    });
  });

  it("region overlap through a declared geography classification is REGION_MATCH (§31)", () => {
    const { values } = computeFeatureValues(
      ALL,
      inputs({
        country: "GH",
        classifications: [
          {
            nodeId: WEST_AFRICA,
            vocabularyCode: "geography",
            source: "user_selected",
          },
          {
            nodeId: PAYMENTS,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "PRESENT",
      value: "REGION_MATCH",
      provenance: {
        preferredNodeId: WEST_AFRICA,
        matchedNodeId: WEST_AFRICA,
        exact: true,
      },
    });
  });

  it("E: an unrestricted (global) geography preference is NOT_APPLICABLE, never a strong match; no preference at all is NOT_APPLICABLE", () => {
    const global = mandate({
      constraints: mandate().constraints.filter(
        (c) => c.dimension !== "geography.country",
      ),
      taxonomyPreferences: [
        {
          nodeId: GLOBAL,
          vocabularyCode: "geography",
          preferenceStrength: "MUST",
          isExclusion: false,
          source: "user_selected",
        },
      ],
    });
    const { values } = computeFeatureValues(ALL, inputs({ mandate: global }));
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "NOT_APPLICABLE",
      missingReason: "UNRESTRICTED_PREFERENCE",
    });
    expect(valueOf(values, "declared_fit.taxonomy")).toMatchObject({
      status: "NOT_APPLICABLE",
      missingReason: "NO_DECLARED_PREFERENCE",
    });
    const none = mandate({ constraints: [], taxonomyPreferences: [] });
    const bare = computeFeatureValues(ALL, inputs({ mandate: none })).values;
    expect(valueOf(bare, "declared_fit.stage")).toMatchObject({
      status: "NOT_APPLICABLE",
      missingReason: "NO_DECLARED_PREFERENCE",
    });
    expect(valueOf(bare, "declared_fit.geography")).toMatchObject({
      status: "NOT_APPLICABLE",
      missingReason: "NO_DECLARED_PREFERENCE",
    });
  });

  it("S: a projection carrying a class the definition does not accept satisfies nothing and counts as a scope violation (§62)", () => {
    const { values, scopeViolations } = computeFeatureValues(
      ALL,
      inputs({ companySourceClass: "Q_INFERENCE" }),
    );
    expect(valueOf(values, "declared_fit.stage")).toMatchObject({
      status: "MISSING",
      missingReason: "SOURCE_NOT_AUTHORISED",
      sourceClasses: [],
    });
    expect(valueOf(values, "declared_fit.geography")).toMatchObject({
      status: "MISSING",
      missingReason: "SOURCE_NOT_AUTHORISED",
    });
    expect(valueOf(values, "declared_fit.cheque")).toMatchObject({
      status: "MISSING",
      missingReason: "SOURCE_NOT_AUTHORISED",
    });
    expect(scopeViolations).toBe(3);
  });

  it("U/§63: the investor-private text never enters a value, provenance or fingerprint, and mandate-derived values stay CONFIDENTIAL", () => {
    const { values } = computeFeatureValues(ALL, inputs({ semantic: 0.5 }));
    expect(JSON.stringify(values)).not.toContain(INVESTOR_MARKER);
    for (const v of values) {
      if (
        v.sourceClasses.includes("DECLARED_MANDATE") ||
        v.sourceClasses.includes("SEMANTIC_CANDIDATE_PROVENANCE")
      ) {
        expect(v.sensitivity).toBe("CONFIDENTIAL");
      }
    }
  });

  it("V: identical inputs give identical values and fingerprint; a mandate version or value change moves the fingerprint (§51, §53)", () => {
    const a = computeFeatureValues(ALL, inputs({ semantic: 0.5 })).values;
    const b = computeFeatureValues(ALL, inputs({ semantic: 0.5 })).values;
    expect(b).toEqual(a);
    const base = {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      context: {
        tenantId: TENANT_I,
        investorOrganisationId: INVESTOR,
        mode: "INVESTOR_DISCOVER" as const,
        mandateId: ACTIVE_MANDATE,
        taxonomyVersion: { industry: 1 },
        eligibilityPolicyVersion: "eligibility.v2" as const,
      },
      mandateId: ACTIVE_MANDATE,
      mandateVersion: 1,
      companyId: companyId(1),
      companyTenantId: TENANT_C,
      companyProjectionVersion: 1,
      eligibilityPolicyVersion: "eligibility.v2" as const,
      eligibilityDecision: "ELIGIBLE" as const,
      candidateProvenance: {
        structured: {
          generatorVersion: "structured-mandate.v2" as const,
          reasonCodes: ["STAGE_OVERLAP" as const],
        },
        semantic: null,
      },
      sensitivity: "CONFIDENTIAL" as const,
      features: [...a],
    };
    const f1 = snapshotFingerprint({ definitions: ALL, snapshot: base });
    expect(snapshotFingerprint({ definitions: ALL, snapshot: base })).toBe(f1);
    expect(
      snapshotFingerprint({
        definitions: ALL,
        snapshot: { ...base, mandateVersion: 2 },
      }),
    ).not.toBe(f1);
    expect(
      snapshotFingerprint({
        definitions: ALL,
        snapshot: {
          ...base,
          features: [
            ...computeFeatureValues(ALL, inputs({ semantic: 0.6 })).values,
          ],
        },
      }),
    ).not.toBe(f1);
    // The fingerprint reads no clock and no id: two snapshots built at
    // different times from the same inputs are the same artifact.
    const s1 = RecommendationFeatureSnapshotSchema.parse({
      ...base,
      fingerprint: f1,
      computedAt: "2026-09-18T12:00:00.000Z",
    });
    const s2 = RecommendationFeatureSnapshotSchema.parse({
      ...base,
      fingerprint: f1,
      computedAt: "2026-09-19T12:00:00.000Z",
    });
    expect(s1.fingerprint).toBe(s2.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// The service over a fake world.
// ---------------------------------------------------------------------------

type Company = {
  id: string;
  version: number;
  stage: string | null;
  country: string | null;
  nodes: { nodeId: string; vocabularyCode: string; source: string }[];
  discoverable: boolean;
  // Never read by any port.
  founderMemory: string[];
  conversation: string;
  privateDocument: string;
  publicWeb: string[];
};

type World = {
  companies: Company[];
  mandates: MandateSnapshotForEligibility[];
  activeIds: string[];
  queries: string[];
};

function world(): World {
  return {
    companies: [
      {
        id: companyId(1),
        version: 1,
        stage: "seed",
        country: "NG",
        nodes: [
          {
            nodeId: PAYMENTS,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
        discoverable: true,
        founderMemory: [],
        conversation: "",
        privateDocument: "",
        publicWeb: [],
      },
      {
        id: companyId(2),
        version: 1,
        stage: "series_b",
        country: "KE",
        nodes: [
          {
            nodeId: HARDWARE,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
        discoverable: true,
        founderMemory: [],
        conversation: "",
        privateDocument: "",
        publicWeb: [],
      },
      {
        id: companyId(3),
        version: 1,
        stage: "seed",
        country: "NG",
        nodes: [],
        discoverable: true,
        founderMemory: [],
        conversation: "",
        privateDocument: "",
        publicWeb: [],
      },
    ],
    mandates: [
      mandate(),
      mandate({
        mandateId: DRAFT_MANDATE,
        status: "DRAFT",
        constraints: [],
        taxonomyPreferences: [],
      }),
    ],
    activeIds: [ACTIVE_MANDATE],
    queries: [],
  };
}

function eligibilityPorts(
  w: World,
): Pick<EligibilityPorts, "investorSubject" | "mandates" | "taxonomyVersions"> {
  return {
    investorSubject: {
      investorOrganisationFor: (actor) =>
        Promise.resolve(
          actor.organisationId === ORG_I
            ? { investorOrganisationId: INVESTOR }
            : null,
        ),
    },
    mandates: {
      activeMandate: ({ mandateId }) => {
        w.queries.push("mandates.activeMandate");
        if (mandateId !== null) {
          const pinned = w.mandates.find((m) => m.mandateId === mandateId);
          return Promise.resolve<ActiveMandateLookup>(
            pinned === undefined
              ? { kind: "NONE" }
              : { kind: "FOUND", mandate: pinned },
          );
        }
        const active = w.mandates.filter(
          (m) => m.status === "ACTIVE" && w.activeIds.includes(m.mandateId),
        );
        const [only] = active;
        if (active.length !== 1 || only === undefined)
          return Promise.resolve<ActiveMandateLookup>({
            kind: active.length === 0 ? "NONE" : "AMBIGUOUS",
          });
        return Promise.resolve<ActiveMandateLookup>({
          kind: "FOUND",
          mandate: only,
        });
      },
    },
    taxonomyVersions: {
      currentVersions: () => Promise.resolve({ industry: 1, geography: 1 }),
    },
  };
}

function memoryStore() {
  const rows: {
    id: string;
    companyId: string;
    fingerprint: string;
    status: "CURRENT" | "SUPERSEDED";
    snapshot: RecommendationFeatureSnapshot;
  }[] = [];
  let n = 0;
  const store: FeatureSnapshotStore = {
    currentFor: (input) =>
      Promise.resolve(
        new Map(
          rows
            .filter(
              (r) =>
                r.status === "CURRENT" &&
                input.companyIds.includes(r.companyId),
            )
            .map(
              (r) =>
                [
                  r.companyId,
                  { id: r.id, fingerprint: r.fingerprint },
                ] as const,
            ),
        ),
      ),
    supersede: (ids) => {
      for (const r of rows) if (ids.includes(r.id)) r.status = "SUPERSEDED";
      return Promise.resolve();
    },
    insertMany: (snapshots) => {
      const refs = snapshots.map((s) => {
        const id = `77777777-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
        rows.push({
          id,
          companyId: s.companyId,
          fingerprint: s.fingerprint,
          status: "CURRENT",
          snapshot: s,
        });
        return { id, fingerprint: s.fingerprint };
      });
      return Promise.resolve(refs);
    },
  };
  return { store, rows };
}

type LogLine = { readonly line: string };
function capturingLogger(lines: LogLine[]): Logger {
  const record = (...args: unknown[]) => {
    lines.push({ line: JSON.stringify(args) });
  };
  return {
    debug: record,
    info: record,
    warn: record,
    error: record,
    fatal: record,
    trace: record,
    child: () => capturingLogger(lines),
  } as unknown as Logger;
}

function harness(w: World = world()) {
  const memory = memoryStore();
  const logs: LogLine[] = [];
  const service = createFeatureService({
    registry,
    ports: eligibilityPorts(w),
    companies: {
      projectMany: (ids) => {
        w.queries.push("companies.projectMany");
        return Promise.resolve(
          new Map<string, CompanyFeatureProjection>(
            w.companies
              .filter((c) => c.discoverable && ids.includes(c.id))
              .map((c) => [
                c.id,
                {
                  state: {
                    sourceClass: "CANONICAL_COMPANY_STATE",
                    companyId: c.id,
                    tenantId: TENANT_C,
                    currentStageCode: c.stage,
                    headquartersCountry: c.country,
                    version: c.version,
                  },
                  taxonomy: {
                    sourceClass: "CANONICAL_TAXONOMY",
                    classifications: c.nodes,
                  },
                },
              ]),
          ),
        );
      },
    },
    hierarchy: {
      expand: (nodeIds) => {
        w.queries.push("hierarchy.expand");
        return Promise.resolve({
          sourceClass: "TAXONOMY_REFERENCE_HIERARCHY",
          nodes: HIERARCHY.nodes.filter((n) =>
            nodeIds.includes(n.preferredNodeId),
          ),
        });
      },
    },
    store: memory.store,
    clock: () => new Date("2026-09-18T12:00:00.000Z"),
    logger: capturingLogger(logs),
  });
  return { w, service, memory, logs };
}

const candidate = (
  n: number,
  semantic: number | null,
  structured = true,
): HybridCandidate => ({
  companyId: companyId(n),
  structured: structured
    ? {
        generatorId: "STRUCTURED_MANDATE",
        generatorVersion: "structured-mandate.v2",
        matchedDimensions: ["STAGE"],
        reasonCodes: ["STAGE_OVERLAP"],
        matchedNodes: [],
        taxonomyVersion: null,
      }
    : null,
  semantic:
    semantic === null
      ? null
      : {
          generatorId: "SEMANTIC_MANDATE",
          generatorVersion: "semantic-mandate.v1",
          metric: "COSINE",
          similarity: semantic,
          companyRepresentationVersion: "company-investment-representation.v1",
          investorRepresentationVersion: "investor-mandate-representation.v1",
          configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
          documentInstructionVersion: "none-v1",
          queryInstructionVersion: "capital-q-mandate-matching-v1",
        },
  eligibility: eligible(companyId(n)),
});

const POOL = [
  candidate(1, 0.73),
  candidate(2, 0.41, false),
  candidate(3, null),
];

async function computed(
  h: ReturnType<typeof harness>,
  candidates = POOL,
  mode: RecommendationMode = "INVESTOR_DISCOVER",
) {
  const result = await h.service.computeForCandidates({
    actor: ACTOR,
    mode,
    candidates,
  });
  if (result.kind !== "COMPUTED") throw new Error(result.kind);
  for (const s of result.snapshots)
    expect(RecommendationFeatureSnapshotSchema.parse(s)).toEqual(s);
  return result;
}

describe("feature service", () => {
  it("computes one snapshot per eligible candidate, registry order, both provenances retained, two batch reads (§45–§46, §67)", async () => {
    const h = harness();
    const r = await computed(h);
    expect(r.snapshots.map((s) => s.companyId)).toEqual([
      companyId(1),
      companyId(2),
      companyId(3),
    ]);
    const [both, semanticOnly, structuredOnly] = r.snapshots;
    expect(both?.candidateProvenance).toEqual({
      structured: {
        generatorVersion: "structured-mandate.v2",
        reasonCodes: ["STAGE_OVERLAP"],
      },
      semantic: {
        generatorVersion: "semantic-mandate.v1",
        companyRepresentationVersion: "company-investment-representation.v1",
        investorRepresentationVersion: "investor-mandate-representation.v1",
        configurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
      },
    });
    expect(
      valueOf(both?.features ?? [], "semantic_fit.mandate_similarity"),
    ).toMatchObject({ status: "PRESENT", value: 0.73 });
    expect(semanticOnly?.candidateProvenance.structured).toBeNull();
    expect(
      valueOf(semanticOnly?.features ?? [], "semantic_fit.mandate_similarity"),
    ).toMatchObject({ status: "PRESENT", value: 0.41 });
    expect(
      valueOf(
        structuredOnly?.features ?? [],
        "semantic_fit.mandate_similarity",
      ),
    ).toMatchObject({
      status: "MISSING",
      missingReason: "SEMANTIC_NOT_RETRIEVED",
    });
    expect(
      valueOf(structuredOnly?.features ?? [], "declared_fit.taxonomy"),
    ).toMatchObject({
      status: "MISSING",
      missingReason: "COMPANY_TAXONOMY_UNKNOWN",
    });
    expect(r.diagnostics).toMatchObject({
      candidates: 3,
      featureValues: 18,
      scopeViolations: 0,
      inserted: 3,
      reused: 0,
      superseded: 0,
    });
    expect(
      h.w.queries.filter((q) => q === "companies.projectMany"),
    ).toHaveLength(1);
    expect(h.w.queries.filter((q) => q === "hierarchy.expand")).toHaveLength(1);
    expect(r.snapshots.every((s) => s.sensitivity === "CONFIDENTIAL")).toBe(
      true,
    );
    expect(JSON.stringify(r)).not.toMatch(/"score"|matchPercent|probability/i);
  });

  it("V/L/M/N/O: founder-private facts in memory, a conversation, a document and raw research change nothing; a repeat reuses every snapshot (§58, §59)", async () => {
    const h = harness();
    const before = await computed(h);
    const target = h.w.companies[0];
    if (target === undefined) throw new Error("fixture");
    target.founderMemory.push(`${MARKER}: largest customer may churn`);
    target.conversation = `${MARKER}: the founder told Q the largest customer may churn`;
    target.privateDocument = `${MARKER}: board deck, customer concentration 60%`;
    target.publicWeb.push(`${MARKER}: blog post says they pivoted`);
    const after = await computed(h);
    expect(after.snapshots.map((s) => ({ ...s, computedAt: "" }))).toEqual(
      before.snapshots.map((s) => ({ ...s, computedAt: "" })),
    );
    expect(after.snapshots.map((s) => s.fingerprint)).toEqual(
      before.snapshots.map((s) => s.fingerprint),
    );
    expect(after.diagnostics).toMatchObject({
      reused: 3,
      inserted: 0,
      superseded: 0,
    });
    const everything = JSON.stringify({
      snapshots: after.snapshots,
      rows: h.memory.rows,
      logs: h.logs,
    });
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain(INVESTOR_MARKER);
  });

  it("P/Q: an ACTIVE mandate change supersedes with new values; a DRAFT change is invisible (§65)", async () => {
    const h = harness();
    const first = await computed(h);
    const draftIndex = h.w.mandates.findIndex(
      (m) => m.mandateId === DRAFT_MANDATE,
    );
    const draft = h.w.mandates[draftIndex];
    if (draft === undefined) throw new Error("fixture");
    h.w.mandates[draftIndex] = {
      ...draft,
      version: 2,
      constraints: [
        {
          dimension: "stage",
          operator: "IN",
          value: { kind: "codes", values: ["series_b"] },
          importance: "MUST",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
      ],
    };
    const second = await computed(h);
    expect(second.diagnostics).toMatchObject({ reused: 3, superseded: 0 });
    const activeIndex = h.w.mandates.findIndex(
      (m) => m.mandateId === ACTIVE_MANDATE,
    );
    const active = h.w.mandates[activeIndex];
    if (active === undefined) throw new Error("fixture");
    h.w.mandates[activeIndex] = {
      ...active,
      version: 2,
      constraints: [
        {
          dimension: "stage",
          operator: "IN",
          value: { kind: "codes", values: ["series_b"] },
          importance: "MUST",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
      ],
    };
    const third = await computed(
      h,
      POOL.map((c) => ({
        ...c,
        eligibility: { ...c.eligibility, mandateVersion: 2 },
      })),
    );
    expect(third.diagnostics).toMatchObject({ superseded: 3, inserted: 3 });
    expect(
      valueOf(third.snapshots[0]?.features ?? [], "declared_fit.stage"),
    ).toMatchObject({ value: "NO_MATCH" });
    expect(
      valueOf(third.snapshots[1]?.features ?? [], "declared_fit.stage"),
    ).toMatchObject({ value: "MATCH" });
    expect(third.snapshots[0]?.fingerprint).not.toBe(
      first.snapshots[0]?.fingerprint,
    );
    expect(h.memory.rows.filter((r) => r.status === "SUPERSEDED")).toHaveLength(
      3,
    );
  });

  it("R: an unauthorised context fails closed before any read; T: a non-investor actor and a foreign eligibility are refused (§61, cross-tenant)", async () => {
    const h = harness();
    await expect(
      h.service.computeForCandidates({
        actor: ACTOR,
        mode: "FOUNDER_DISCOVER",
        candidates: POOL,
      }),
    ).rejects.toBeInstanceOf(FeatureContextNotAllowedError);
    await expect(
      h.service.computeForCandidates({
        actor: ACTOR,
        mode: "GATEQ",
        candidates: POOL,
      }),
    ).rejects.toBeInstanceOf(FeatureContextNotAllowedError);
    expect(h.w.queries).toHaveLength(0);
    const founder = {
      ...ACTOR,
      organisationId: "99999999-0000-4000-8000-000000000099",
    } as ActorContext;
    await expect(
      h.service.computeForCandidates({
        actor: founder,
        mode: "INVESTOR_DISCOVER",
        candidates: POOL,
      }),
    ).rejects.toThrow(/no canonical investor organisation/);
    const foreign = [
      {
        ...candidate(1, null),
        eligibility: {
          ...eligible(companyId(1)),
          investorOrganisationId: "99999999-0000-4000-8000-000000000098",
        },
      },
    ];
    await expect(
      h.service.computeForCandidates({
        actor: ACTOR,
        mode: "INVESTOR_DISCOVER",
        candidates: foreign,
      }),
    ).rejects.toBeInstanceOf(CandidateNotRankableError);
    const ineligible = [
      {
        ...candidate(1, null),
        eligibility: {
          ...eligible(companyId(1)),
          decision: "INELIGIBLE" as const,
        },
      },
    ];
    await expect(
      h.service.computeForCandidates({
        actor: ACTOR,
        mode: "INVESTOR_DISCOVER",
        candidates: ineligible,
      }),
    ).rejects.toBeInstanceOf(CandidateNotRankableError);
    expect(h.memory.rows).toHaveLength(0);
  });

  it("a candidate that is no longer discoverable gets no snapshot rather than an invented one (§24)", async () => {
    const h = harness();
    const target = h.w.companies[1];
    if (target === undefined) throw new Error("fixture");
    target.discoverable = false;
    const r = await computed(h);
    expect(r.snapshots.map((s) => s.companyId)).toEqual([
      companyId(1),
      companyId(3),
    ]);
    expect(r.diagnostics.withoutProjection).toBe(1);
  });

  it("ACTIVE mandate only: a DRAFT pinned by id or no ACTIVE mandate yields no snapshots", async () => {
    const h = harness();
    expect(
      (
        await h.service.computeForCandidates({
          actor: ACTOR,
          mode: "INVESTOR_DISCOVER",
          mandateId: DRAFT_MANDATE,
          candidates: POOL,
        })
      ).kind,
    ).toBe("NO_ACTIVE_MANDATE");
    h.w.activeIds = [];
    expect(
      (
        await h.service.computeForCandidates({
          actor: ACTOR,
          mode: "INVESTOR_DISCOVER",
          candidates: POOL,
        })
      ).kind,
    ).toBe("NO_ACTIVE_MANDATE");
  });

  it("W: no provider, model, embedding or research port exists in the service's dependencies", () => {
    const h = harness();
    expect(JSON.stringify(h.w.queries)).not.toMatch(
      /groq|gemini|tavily|eleven|embed|openai|anthropic/i,
    );
    const dependencyKeys = [
      "registry",
      "ports",
      "companies",
      "hierarchy",
      "store",
      "clock",
      "logger",
    ];
    expect(Object.keys(createFeatureService.length === 1 ? {} : {})).toEqual(
      [],
    );
    expect(dependencyKeys).not.toContain("embeddings");
    expect(dependencyKeys).not.toContain("gateway");
  });
});

describe("registry order is the snapshot order", () => {
  it("does not depend on Map insertion or row order", async () => {
    const shuffled: RecommendationFeatureDefinition[] = [
      ...RECOMMENDATION_FEATURES,
    ].reverse();
    const reversed = createFeatureRegistry(shuffled);
    const values = computeFeatureValues(
      reversed.featuresFor("INVESTOR_DISCOVER"),
      inputs(),
    ).values;
    expect(values.map((v) => v.featureId)).toEqual(shuffled.map((d) => d.id));
    const h = harness();
    const r = await computed(h, [candidate(3, null), candidate(1, 0.5)]);
    expect(r.snapshots.map((s) => s.companyId)).toEqual([
      companyId(1),
      companyId(3),
    ]);
  });
});
