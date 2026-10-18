import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  createSyntheticDemoRoutingAllowance,
  type FakeBehaviour,
} from "@capital-q/model-gateway";
import type { FitExplanationResult } from "@capital-q/q-core";

import {
  createRecommendationNarrator,
  groundingFailure,
  NARRATION_UNAVAILABLE_REASONS,
  type NarratableFactor,
} from "../src/recommendation/narrator.js";
import { narratorCatalog } from "./support/narrator-catalog.js";

/**
 * Q phrasing a recommendation explanation (CQ-REC-007 C).
 *
 * The properties: the model receives bounded factor labels and nothing
 * private; it may phrase but not add, re-rank or quantify; every failure —
 * outage, rate limit, refusal, ungrounded answer — is in-band so the
 * caller can fall back to the deterministic explanation it already has.
 */

const REQUEST = {
  tenantId: "11111111-0000-4000-8000-000000000001",
  userId: "11111111-0000-4000-8000-000000000003",
  correlationId: "cor_11111111-0000-4000-8000-000000000009",
  companyDescription: "Logistics workflow software for African distributors.",
  investorDescription: "the criteria this investor's own mandate declares",
  matchedFactors: [
    { dimension: "STAGE", outcome: "MATCH", label: "Stage matches" },
    { dimension: "GEOGRAPHY", outcome: "MATCH", label: "Country matches" },
  ] as readonly NarratableFactor[],
  mismatchedFactors: [
    { dimension: "TAXONOMY", outcome: "MISMATCH", label: "Sector does not" },
  ] as readonly NarratableFactor[],
  uncertainties: [
    {
      dimension: "SEMANTIC",
      outcome: "UNKNOWN",
      label: "No description-level comparison was made",
    },
  ] as readonly NarratableFactor[],
};

const answer = (
  overrides: Partial<FitExplanationResult> = {},
): FakeBehaviour => ({
  kind: "JSON",
  value: {
    explanation:
      "You're seeing this because the stage and the country line up with what your mandate names. The sector is not one you listed, and no description-level comparison was made.",
    matched: [],
    notMatched: [],
    hardConstraintsFailed: [],
    unknowns: [],
    confidence: "MODERATE",
    overallFitRestated: null,
    ...overrides,
  },
});

function build(script: readonly FakeBehaviour[], demo = false) {
  const provider = createFakeModelProvider({ code: "beta", script });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(narratorCatalog()),
    registry: createModelProviderRegistry([provider]),
    usage: createInMemoryModelUsageRepository(),
    syntheticDemo: demo
      ? createSyntheticDemoRoutingAllowance({
          operatorEnabled: true,
          environment: "test",
          databaseUrl:
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        })
      : null,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  const narrator = createRecommendationNarrator({
    gateway,
    ...(demo ? { dataPosture: "SYNTHETIC_DEMO" as const } : {}),
  });
  return { narrator, provider };
}

describe("recommendation narrator (CQ-REC-007)", () => {
  it("phrases the supplied factors, and sends the model nothing but them", async () => {
    const { narrator, provider } = build([answer()], true);
    const result = await narrator.narrate(REQUEST);
    expect(result.kind).toBe("NARRATED");
    if (result.kind !== "NARRATED") return;
    expect(result.summary).toContain("stage");
    expect(result.providerCode).toBe("beta");

    // What crossed the boundary: the labels and the company's own line.
    const sent = JSON.stringify(provider.calls[0]?.request);
    expect(sent).toContain("STAGE");
    expect(sent).toContain("Logistics workflow software");
    // And nothing the ranker kept to itself. (The prompt's own wording
    // forbids re-weighting, so "weight" appears there legitimately; what
    // must never appear is the ranker's private arithmetic and ids.)
    expect(sent).not.toMatch(
      /internalScore|featureSnapshotId|fingerprint|normalizedValue|contribution|configuredWeight/i,
    );
    expect(sent).not.toContain("0.8");
  });

  it("nothing to explain is not asked of a model", async () => {
    const { narrator, provider } = build([answer()]);
    expect(
      await narrator.narrate({
        ...REQUEST,
        matchedFactors: [],
        mismatchedFactors: [],
        uncertainties: [],
      }),
    ).toEqual({ kind: "UNAVAILABLE", reason: "NO_FACTORS" });
    expect(provider.calls).toHaveLength(0);
  });

  it("an outage and a rate limit are both in-band, and neither throws", async () => {
    // The exact code depends on how far the gateway got before it gave up
    // — with one candidate in the catalogue an exhausted route is reported
    // as POLICY_INELIGIBLE either way. What this pins is the property the
    // caller relies on: a reason, never an exception, and always one of
    // the declared reasons, so the deterministic explanation still shows.
    for (const failureClass of [
      "PROVIDER_OUTAGE",
      "RATE_LIMIT",
      "TIMEOUT",
    ] as const) {
      const { narrator } = build([{ kind: "FAIL", failureClass }]);
      const result = await narrator.narrate(REQUEST);
      expect(result.kind).toBe("UNAVAILABLE");
      if (result.kind !== "UNAVAILABLE") return;
      expect(NARRATION_UNAVAILABLE_REASONS).toContain(result.reason);
      expect(result.reason).not.toBe("NO_FACTORS");
    }
  });

  it("a provider's raw error never escapes", async () => {
    const { narrator } = build([
      { kind: "THROW_RAW", message: "429 quota projects/secret-project" },
    ]);
    const result = await narrator.narrate(REQUEST);
    expect(result.kind).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("secret-project");
  });
});

describe("explanation grounding (CQ-REC-007 §30, §36)", () => {
  const supplied = [
    ...REQUEST.matchedFactors,
    ...REQUEST.mismatchedFactors,
    ...REQUEST.uncertainties,
  ];
  const result = (
    overrides: Partial<FitExplanationResult>,
  ): FitExplanationResult => ({
    explanation: "Stage and country line up; the sector is not one you named.",
    matched: [],
    notMatched: [],
    hardConstraintsFailed: [],
    unknowns: [],
    confidence: "MODERATE",
    overallFitRestated: null,
    ...overrides,
  });

  it("accepts an answer that only restates the supplied factors", () => {
    expect(groundingFailure(result({}), supplied)).toBeNull();
  });

  it("refuses an invented overall verdict", () => {
    expect(
      groundingFailure(result({ overallFitRestated: "STRONG_FIT" }), supplied),
    ).toBe("OVERALL_FIT_INVENTED");
  });

  it("refuses a quantity: an ordering is not a probability", () => {
    for (const explanation of [
      "This is a 92% match for your mandate.",
      "The similarity here is high.",
      "It scored well against your preferences.",
      "There is a strong likelihood of investment.",
    ]) {
      expect(groundingFailure(result({ explanation }), supplied)).toBe(
        "QUANTITY_CLAIMED",
      );
    }
  });

  it("refuses a reason the ranker never produced", () => {
    // Cheque was not among the supplied factors.
    expect(
      groundingFailure(
        result({
          explanation: "The cheque size you write fits this round neatly.",
        }),
        supplied,
      ),
    ).toBe("DIMENSION_NOT_SUPPLIED:CHEQUE");
  });

  it("refuses turning an unknown into a match", () => {
    expect(
      groundingFailure(
        result({
          matched: ["What the business does is a close match"] as never,
        }),
        supplied,
      ),
    ).toBe("UNKNOWN_CLAIMED_AS_MATCH:SEMANTIC");
  });
});
