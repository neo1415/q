import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCurrentSlateExplanationService } from "../src/explanations/current.js";
import {
  createRecommendationExplanationService,
  type ExplanationSnapshotPort,
} from "../src/explanations/service.js";
import {
  deterministicSummary,
  toExplanationFactors,
} from "../src/explanations/policy.js";
import {
  FEATURE_SCHEMA_VERSION,
  RecommendationFeatureSnapshotSchema,
  type FeatureValue,
  type RecommendationFeatureSnapshot,
} from "../src/features/contracts.js";
import {
  createFeatureRegistry,
  snapshotFingerprint,
} from "../src/features/policy.js";
import { RANKING_CONFIG_V1 } from "../src/ranking/config.js";
import { RANKER_VERSION, type FactorResult } from "../src/ranking/contracts.js";
import type { SlateKey } from "../src/slates/ports.js";
import { memorySlates } from "./support/memory-slates.js";

/**
 * Recommendation explanations (CQ-REC-007 B; doc 19 §56–§58, §188, §189).
 *
 * The properties under test: an explanation says which declared criteria
 * matched, which did not and what is unknown; absence is never a
 * shortcoming; no score, weight or similarity reaches a reader; it is
 * built from the item's OWN snapshot under the SLATE's ranking version, or
 * it is refused; and a slate belonging to somebody else is indistinguishable
 * from one that does not exist.
 */

const MARKER = "REC007_PRIVATE_FOUNDER_DATA_MUST_NOT_BE_EXPLAINED";
const TENANT = "11111111-0000-4000-8000-000000000001";
const ORG = "11111111-0000-4000-8000-000000000002";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000014";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "66666666-0000-4000-8000-000000000001";

const actor: ActorContext = ActorContextSchema.parse({
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});

const KEY: SlateKey = {
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mode: "INVESTOR_DISCOVER",
};

// ---------------------------------------------------------------------------
// The pure half.
// ---------------------------------------------------------------------------

function factor(
  featureId: string,
  reasonCode: FactorResult["reasonCode"],
  options: {
    readonly outcome?: FactorResult["outcome"];
    readonly missingReason?: FactorResult["missingReason"];
  } = {},
): FactorResult {
  const outcome = options.outcome ?? "SCORED";
  return {
    featureId,
    featureVersion: "v1",
    group: featureId.startsWith("semantic") ? "SEMANTIC_FIT" : "DECLARED_FIT",
    featureStatus: outcome === "SCORED" ? "PRESENT" : "MISSING",
    outcome,
    featureValue: outcome === "SCORED" ? "MATCH" : null,
    missingReason: options.missingReason ?? null,
    normalizedValue: outcome === "SCORED" ? 1 : null,
    configuredWeight: 1,
    contribution: outcome === "SCORED" ? 0.25 : null,
    polarity: outcome === "SCORED" ? "POSITIVE" : null,
    reasonCode,
    sourceClasses: [],
  };
}

describe("explanation factors (CQ-REC-007)", () => {
  it("sorts every ranker reason code into the bucket that states what it means", () => {
    const buckets = toExplanationFactors([
      factor("declared_fit.stage", "STAGE_ALIGNED"),
      factor("declared_fit.geography", "GEOGRAPHY_REGION_ALIGNED"),
      factor("declared_fit.taxonomy", "TAXONOMY_MISMATCH"),
      factor("semantic_fit.mandate_similarity", "FACTOR_MISSING", {
        outcome: "MISSING",
        missingReason: "SEMANTIC_NOT_RETRIEVED",
      }),
    ]);
    expect(buckets.matchedFactors.map((f) => f.dimension)).toEqual([
      "STAGE",
      "GEOGRAPHY",
    ]);
    // Region alignment is alignment, but weaker, and says so.
    expect(buckets.matchedFactors[1]?.outcome).toBe("PARTIAL");
    expect(buckets.mismatchedFactors.map((f) => f.dimension)).toEqual([
      "TAXONOMY",
    ]);
    expect(buckets.uncertainties.map((f) => f.dimension)).toEqual(["SEMANTIC"]);
    // Every factor keeps the ranker's own code: the audit link back.
    expect(buckets.mismatchedFactors[0]?.reasonCode).toBe("TAXONOMY_MISMATCH");
  });

  it("missing evidence is an uncertainty, never a mismatch, and says which kind of absence", () => {
    const unknownCompany = toExplanationFactors([
      factor("declared_fit.stage", "FACTOR_MISSING", {
        outcome: "MISSING",
        missingReason: "COMPANY_STAGE_UNKNOWN",
      }),
    ]);
    expect(unknownCompany.mismatchedFactors).toEqual([]);
    expect(unknownCompany.uncertainties[0]?.outcome).toBe("UNKNOWN");
    expect(unknownCompany.uncertainties[0]?.label).toContain(
      "has not stated its stage",
    );

    const undeclaredMandate = toExplanationFactors([
      factor("declared_fit.taxonomy", "FACTOR_MISSING", {
        outcome: "MISSING",
        missingReason: "NO_DECLARED_PREFERENCE",
      }),
    ]);
    // A criterion the investor never set is not the company's failing.
    expect(undeclaredMandate.uncertainties[0]?.label).toContain(
      "your mandate does not name one",
    );
    expect(undeclaredMandate.mismatchedFactors).toEqual([]);
  });

  it("the hard eligibility gate is not described as a merit", () => {
    const buckets = toExplanationFactors([
      factor("eligibility.hard_gate", "STAGE_ALIGNED"),
      factor("declared_fit.stage", "STAGE_ALIGNED"),
    ]);
    expect(
      [
        ...buckets.matchedFactors,
        ...buckets.mismatchedFactors,
        ...buckets.uncertainties,
      ].map((f) => f.dimension),
    ).toEqual(["STAGE"]);
  });

  it("the deterministic summary reads as English and carries no number", () => {
    const summary = deterministicSummary(
      toExplanationFactors([
        factor("declared_fit.stage", "STAGE_ALIGNED"),
        factor("declared_fit.geography", "GEOGRAPHY_COUNTRY_ALIGNED"),
        factor("declared_fit.taxonomy", "TAXONOMY_RELATED"),
        factor("semantic_fit.mandate_similarity", "FACTOR_MISSING", {
          outcome: "MISSING",
          missingReason: "SEMANTIC_NOT_RETRIEVED",
        }),
      ]),
    );
    expect(summary).toContain("Stage and geography match");
    expect(summary).toContain("related rather than an exact match");
    expect(summary).toContain("not established");
    // Doc 19 §56: never "87% match".
    expect(summary).not.toMatch(/\d/);
    expect(summary).not.toMatch(/%|score|weight|similarity|probability/i);
  });

  it("nothing comparable is said plainly, not as a poor result", () => {
    const summary = deterministicSummary(toExplanationFactors([]));
    expect(summary).toBe(
      "Nothing in your declared mandate could be compared with this company yet.",
    );
    expect(summary).not.toMatch(/poor|weak|bad|low/i);
  });
});

// ---------------------------------------------------------------------------
// The service.
// ---------------------------------------------------------------------------

const value = (
  featureId: string,
  status: "PRESENT" | "MISSING",
  valueOrReason: string,
): FeatureValue =>
  ({
    featureId,
    featureVersion: "v1",
    status,
    value: status === "PRESENT" ? valueOrReason : null,
    missingReason: status === "PRESENT" ? null : valueOrReason,
    sourceClasses:
      status === "PRESENT"
        ? featureId.startsWith("semantic")
          ? ["SEMANTIC_CANDIDATE_PROVENANCE"]
          : ["DECLARED_MANDATE", "CANONICAL_COMPANY_STATE"]
        : [],
    sensitivity: "CONFIDENTIAL",
    provenance: {},
  }) as unknown as FeatureValue;

function buildSnapshot(): RecommendationFeatureSnapshot {
  const definitions = createFeatureRegistry().featuresFor("INVESTOR_DISCOVER");
  const features = [
    value("eligibility.hard_gate", "PRESENT", "PASS"),
    value("declared_fit.stage", "PRESENT", "MATCH"),
    value("declared_fit.geography", "PRESENT", "COUNTRY_MATCH"),
    value("declared_fit.taxonomy", "PRESENT", "NO_OVERLAP"),
    value("declared_fit.cheque", "MISSING", "CHEQUE_NOT_COMPUTABLE"),
    value(
      "semantic_fit.mandate_similarity",
      "MISSING",
      "SEMANTIC_NOT_RETRIEVED",
    ),
  ];
  const body = {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    context: {
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      mode: "INVESTOR_DISCOVER" as const,
      mandateId: MANDATE,
      taxonomyVersion: null,
      eligibilityPolicyVersion: "eligibility.v2" as const,
    },
    mandateId: MANDATE,
    mandateVersion: 1,
    companyId: COMPANY,
    companyTenantId: COMPANY_TENANT,
    companyProjectionVersion: 1,
    eligibilityPolicyVersion: "eligibility.v2" as const,
    eligibilityDecision: "ELIGIBLE" as const,
    candidateProvenance: {
      structured: {
        generatorVersion: "structured-mandate.v4" as const,
        reasonCodes: ["STAGE_OVERLAP" as const],
      },
      semantic: null,
    },
    sensitivity: "CONFIDENTIAL" as const,
    features,
  };
  return RecommendationFeatureSnapshotSchema.parse({
    ...body,
    fingerprint: snapshotFingerprint({ definitions, snapshot: body }),
    computedAt: "2026-09-19T10:00:00.000Z",
  });
}

const VERSIONS = {
  eligibilityPolicyVersion: "eligibility.v2" as const,
  structuredGeneratorVersion: "structured-mandate.v4" as const,
  semanticGeneratorVersion: "semantic-mandate.v1" as const,
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  rankerVersion: RANKER_VERSION,
  rankingConfigVersion: RANKING_CONFIG_V1.version,
  taxonomyVersion: null,
};

async function harness(
  options: {
    readonly investorOrganisationId?: string;
    readonly snapshot?: RecommendationFeatureSnapshot | null;
    readonly rankingConfigVersion?: string;
  } = {},
) {
  const store = memorySlates();
  const key: SlateKey = {
    ...KEY,
    investorOrganisationId: options.investorOrganisationId ?? INVESTOR,
  };
  const slate = await store.repo.beginBuild({
    ...key,
    mandateVersion: 1,
    versions: {
      ...VERSIONS,
      rankingConfigVersion:
        options.rankingConfigVersion ?? RANKING_CONFIG_V1.version,
    },
    generatedAt: "2026-09-19T09:00:00.000Z",
  });
  const snapshot =
    options.snapshot === undefined ? buildSnapshot() : options.snapshot;
  await store.repo.insertItems(slate.id, key.tenantId, [
    {
      companyId: COMPANY,
      companyTenantId: COMPANY_TENANT,
      rank: 1,
      internalScore: 0.83,
      reasonCodes: ["STAGE_ALIGNED"],
      featureSnapshotId: SNAPSHOT_ID,
      featureSnapshotFingerprint: snapshot?.fingerprint ?? "f".repeat(64),
      candidateProvenance: {
        structured: {
          generatorVersion: "structured-mandate.v4",
          reasonCodes: ["STAGE_OVERLAP"],
        },
        semantic: null,
      },
    },
  ]);
  const published = await store.repo.publish(
    { run: () => Promise.reject(new Error("unused")) },
    {
      slateId: slate.id,
      generationFingerprint: "b".repeat(64),
      itemCount: 1,
      diagnostics: {
        structuredCandidates: 1,
        semanticCandidates: 0,
        semanticUnavailable: false,
        mergedCandidates: 1,
        featureSnapshots: 1,
        ranked: 1,
        scored: 1,
        buildDurationMs: 1,
      },
      publishedAt: "2026-09-19T10:00:00.000Z",
      expiresAt: "2026-09-20T10:00:00.000Z",
    },
  );
  const snapshots: ExplanationSnapshotPort = {
    byId: () => Promise.resolve(snapshot),
  };
  const service = createRecommendationExplanationService({
    ports: {
      investorSubject: {
        investorOrganisationFor: () =>
          Promise.resolve({ investorOrganisationId: INVESTOR }),
      },
    },
    slates: store.repo,
    snapshots,
  });
  return { service, slateId: published.slate.id, store };
}

describe("recommendation explanation service (CQ-REC-007)", () => {
  it("explains an item from its own snapshot, under the version the slate recorded", async () => {
    const h = await harness();
    const result = await h.service.explain({
      actor,
      slateId: h.slateId,
      companyId: COMPANY,
    });
    expect(result.kind).toBe("EXPLAINED");
    if (result.kind !== "EXPLAINED") return;
    const e = result.explanation;
    expect(e.rank).toBe(1);
    expect(e.source).toBe("DETERMINISTIC");
    expect(e.generatedFromRankingVersion).toBe(
      `${RANKER_VERSION}/${RANKING_CONFIG_V1.version}`,
    );
    expect(e.matchedFactors.map((f) => f.dimension)).toEqual([
      "STAGE",
      "GEOGRAPHY",
    ]);
    expect(e.mismatchedFactors.map((f) => f.dimension)).toEqual(["TAXONOMY"]);
    expect(e.uncertainties.map((f) => f.dimension)).toEqual(["SEMANTIC"]);
    expect(e.summary).toContain("Stage and geography match");

    // The internal score produced the ordering and stays behind it.
    const wire = JSON.stringify(e);
    expect(wire).not.toContain("0.83");
    expect(wire).not.toMatch(
      /internalScore|contribution|configuredWeight|normalizedValue|fingerprint|featureSnapshotId/,
    );
    expect(wire).not.toContain(MARKER);
  });

  it("another investor's slate is reported exactly as one that does not exist", async () => {
    const h = await harness({ investorOrganisationId: OTHER_INVESTOR });
    expect(
      await h.service.explain({
        actor,
        slateId: h.slateId,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });

    // And a company that is not in the slate is the same answer.
    const own = await harness();
    expect(
      await own.service.explain({
        actor,
        slateId: own.slateId,
        companyId: "44444444-0000-4000-8000-000000000099",
      }),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
  });

  it("refuses when the snapshot is gone or no longer the one that was ranked", async () => {
    const missing = await harness({ snapshot: null });
    expect(
      await missing.service.explain({
        actor,
        slateId: missing.slateId,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "SNAPSHOT_UNAVAILABLE" });

    // A snapshot whose fingerprint has moved describes inputs the ranker
    // never saw, so it is refused rather than explained.
    const moved = buildSnapshot();
    const store = memorySlates();
    const slate = await store.repo.beginBuild({
      ...KEY,
      mandateVersion: 1,
      versions: VERSIONS,
      generatedAt: "2026-09-19T09:00:00.000Z",
    });
    await store.repo.insertItems(slate.id, TENANT, [
      {
        companyId: COMPANY,
        companyTenantId: COMPANY_TENANT,
        rank: 1,
        internalScore: 0.5,
        reasonCodes: ["STAGE_ALIGNED"],
        featureSnapshotId: SNAPSHOT_ID,
        featureSnapshotFingerprint: "a".repeat(64),
        candidateProvenance: {
          structured: {
            generatorVersion: "structured-mandate.v4",
            reasonCodes: ["STAGE_OVERLAP"],
          },
          semantic: null,
        },
      },
    ]);
    const published = await store.repo.publish(
      { run: () => Promise.reject(new Error("unused")) },
      {
        slateId: slate.id,
        generationFingerprint: "b".repeat(64),
        itemCount: 1,
        diagnostics: {
          structuredCandidates: 1,
          semanticCandidates: 0,
          semanticUnavailable: false,
          mergedCandidates: 1,
          featureSnapshots: 1,
          ranked: 1,
          scored: 1,
          buildDurationMs: 1,
        },
        publishedAt: "2026-09-19T10:00:00.000Z",
        expiresAt: "2026-09-20T10:00:00.000Z",
      },
    );
    const service = createRecommendationExplanationService({
      ports: {
        investorSubject: {
          investorOrganisationFor: () =>
            Promise.resolve({ investorOrganisationId: INVESTOR }),
        },
      },
      slates: store.repo,
      snapshots: { byId: () => Promise.resolve(moved) },
    });
    expect(
      await service.explain({
        actor,
        slateId: published.slate.id,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "SNAPSHOT_UNAVAILABLE" });
  });

  it("refuses to explain an old slate with a ranking config this build no longer carries", async () => {
    const h = await harness({ rankingConfigVersion: "ranking-config.v0" });
    expect(
      await h.service.explain({
        actor,
        slateId: h.slateId,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "RANKING_VERSION_UNAVAILABLE" });
  });
});

/**
 * The same explanation reached from a conversation (CQ-REC-007R B).
 *
 * A person asking Q "why am I seeing this?" has no slate id, so one is
 * resolved from their own investor organisation. The properties worth
 * testing are the ones that would let that resolution become a hole: it
 * must never widen who can see what, and it must not invent an
 * explanation for a company Capital Q did not recommend.
 */
describe("explaining the current slate (CQ-REC-007R B)", () => {
  const currentFor = (
    h: Awaited<ReturnType<typeof harness>>,
    investorOrganisationId: string | null,
  ) =>
    createCurrentSlateExplanationService({
      ports: {
        investorSubject: {
          investorOrganisationFor: () =>
            Promise.resolve(
              investorOrganisationId === null
                ? null
                : { investorOrganisationId },
            ),
        },
      },
      slates: h.store.repo,
      explanations: h.service,
    });

  it("finds the person's own current slate from a company id alone", async () => {
    const h = await harness();
    const result = await currentFor(h, INVESTOR).explainCurrent({
      actor,
      companyId: COMPANY,
    });
    expect(result.kind).toBe("EXPLAINED");
    if (result.kind !== "EXPLAINED") return;
    // The same explanation the HTTP route would have produced for the
    // slate it was handed: one engine, two ways in.
    const direct = await h.service.explain({
      actor,
      slateId: h.slateId,
      companyId: COMPANY,
    });
    expect(direct).toEqual(result);
  });

  it("never reads another investor's slate to answer the question", async () => {
    // The slate belongs to INVESTOR; the person asking resolves to
    // OTHER_INVESTOR. There is nothing of theirs to explain, and the
    // answer is indistinguishable from a company that was never ranked.
    const h = await harness();
    expect(
      await currentFor(h, OTHER_INVESTOR).explainCurrent({
        actor,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
  });

  it("refuses a founder, who has no slate of their own", async () => {
    const h = await harness();
    expect(
      await currentFor(h, null).explainCurrent({ actor, companyId: COMPANY }),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
  });

  it("does not invent an explanation for a company it never recommended", async () => {
    const h = await harness();
    expect(
      await currentFor(h, INVESTOR).explainCurrent({
        actor,
        companyId: "44444444-0000-4000-8000-00000000dead",
      }),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
  });

  it("fails safely when the item's snapshot has gone, rather than explaining without one", async () => {
    const h = await harness({ snapshot: null });
    expect(
      await currentFor(h, INVESTOR).explainCurrent({
        actor,
        companyId: COMPANY,
      }),
    ).toEqual({ kind: "REFUSED", refusal: "SNAPSHOT_UNAVAILABLE" });
  });
});
