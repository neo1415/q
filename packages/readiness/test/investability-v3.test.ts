import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  INVESTABILITY_CURRENT_METHOD_VERSION,
  investabilityPartLines,
} from "@capital-q/contracts";

import type { InvestIQV1Assessment } from "../src/investiq/assess-v1.js";
import {
  INVESTIQ_V2_ARITHMETIC,
  INVESTIQ_V3_ARITHMETIC,
} from "../src/investiq/assess-v1.js";
import {
  GRADED_DIMENSIONS,
  STAGE_BANDS,
  STAGE_WEIGHTS,
} from "../src/investiq/method-v1.js";
import {
  STAGE_WEIGHTS_V3,
  STRONG_REQUIRES,
} from "../src/investiq/method-v3.js";
import {
  assessInvestability,
  INVESTABILITY_METHOD_VERSION,
  strongHeld,
} from "../src/investability/assess.js";
import { gradeFounders } from "../src/investability/grade.js";

/**
 * investiq/v3 (docs/specs/metrics/METRICS-METHODS.md): research-based
 * stage weights, Strong needs Team and Fundamentals above the norm, and a
 * prior exit is graded above a prior founding.
 */
describe("Investability investiq/v3", () => {
  it("is the current method, and every stage's weights sum to 100", () => {
    expect(INVESTABILITY_METHOD_VERSION).toBe(
      "investiq/v3+investability-inputs.v6",
    );
    // The browser-safe copy in contracts never drifts from the scorer.
    expect(INVESTABILITY_CURRENT_METHOD_VERSION).toBe(
      INVESTABILITY_METHOD_VERSION,
    );
    for (const stage of STAGE_BANDS) {
      const sum = GRADED_DIMENSIONS.reduce(
        (s, d) => s + STAGE_WEIGHTS_V3[stage][d],
        0,
      );
      expect(sum).toBe(100);
    }
    expect(INVESTIQ_V3_ARITHMETIC.stageWeights).toBe(STAGE_WEIGHTS_V3);
  });

  it("keeps v2 reproducible: v2 still reads method-v1's weights", () => {
    expect(INVESTIQ_V2_ARITHMETIC.stageWeights).toBeUndefined();
    expect(STAGE_WEIGHTS.PRE_SEED.MANAGEMENT_AND_TEAM).toBe(30);
    expect(STAGE_WEIGHTS_V3.PRE_SEED.MANAGEMENT_AND_TEAM).toBe(35);
  });

  it("weighs the team more early and commercial proof more from Series A", () => {
    const w = STAGE_WEIGHTS_V3;
    expect(w.PRE_SEED.MANAGEMENT_AND_TEAM).toBeGreaterThan(
      w.SERIES_A.MANAGEMENT_AND_TEAM,
    );
    expect(w.SERIES_A.COMMERCIAL_STRENGTH).toBeGreaterThan(
      w.SEED.COMMERCIAL_STRENGTH,
    );
  });

  const withDimensions = (team: number | null, fund: number | null) =>
    ({
      dimensions: [
        { dimension: "MANAGEMENT_AND_TEAM", score: team },
        { dimension: "BUSINESS_FUNDAMENTALS", score: fund },
      ],
    }) as unknown as InvestIQV1Assessment;

  it("Strong needs Team and Fundamentals at 2.5 or more; unknown is not enough", () => {
    expect(STRONG_REQUIRES.minDimensionScore).toBe(2.5);
    expect(strongHeld("STRONG", withDimensions(3, 3))).toBe("STRONG");
    expect(strongHeld("STRONG", withDimensions(3.5, 2))).toBe("INVESTABLE");
    expect(strongHeld("STRONG", withDimensions(null, 4))).toBe("INVESTABLE");
    // Only Strong is held; lower bands are untouched.
    expect(strongHeld("DEVELOPING", withDimensions(null, null))).toBe(
      "DEVELOPING",
    );
  });

  it("grades a prior exit above a prior founding, and neither below the norm", () => {
    const exit = gradeFounders([
      { label: "CEO", value: "Founded and sold a payments company in 2019" },
    ]);
    const founded = gradeFounders([
      {
        label: "CEO",
        value: "Serial founder; previously founded two startups",
      },
    ]);
    expect(exit[0]?.anchor).toBe(4);
    expect(founded[0]?.anchor).toBe(3);
  });
});

describe("Investability parts (audit P1-7, owner decision 78)", () => {
  const AS_OF = "2026-11-07T12:00:00.000Z";
  const fact = (label: string, value: string) => ({
    label,
    value,
    unknownReason: null,
    kind: "TEXT" as const,
    asOf: null,
    pages: [],
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "SELF_REPORTED" as const,
    confidence: "MEDIUM" as const,
  });
  const company = (
    facts: Partial<Record<string, ReturnType<typeof fact>[]>>,
  ): Parameters<typeof assessInvestability>[0] => ({
    companyId: "00000000-0000-4000-8000-0000000000aa",
    stageCode: "seed",
    sectorCodes: ["fintech"],
    businessModelCodes: ["b2b_saas"],
    profile: {
      listed: true,
      description: true,
      website: true,
      updatedAt: AS_OF,
    },
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: [],
    claims: [],
    deck: {
      extractionId: "x",
      readAt: AS_OF,
      sections: DECK_SECTIONS.map((section) => {
        const list = facts[section] ?? [];
        return {
          section,
          status:
            list.length > 0 ? ("PRESENT" as const) : ("NOT_IN_DECK" as const),
          summary: list.length > 0 ? "s" : null,
          pages: [],
          facts: list,
          confidence: "MEDIUM" as const,
        };
      }),
    },
  });

  it("scores business quality and readiness separately, with the headline's caps", () => {
    const { view } = assessInvestability(
      company({
        FOUNDERS: [fact("CEO", "Founded and sold a payments company")],
        MARKET: [fact("TAM", "$4B"), fact("SAM", "SAM $600M bottom-up")],
        BUSINESS_MODEL: [fact("Pricing", "$20 per seat per month")],
        TRACTION: [fact("Monthly revenue", "USD 45,000 MRR")],
        THE_ASK: [
          fact("Raise", "$2M"),
          fact("Instrument", "Post-money SAFE"),
          fact("Use of funds", "Engineering and sales"),
        ],
      }),
      AS_OF,
    );
    expect(view.status).toBe("SCORED");
    const parts = view.parts;
    if (parts === undefined) throw new Error("no parts");
    expect(parts.businessQuality.score).not.toBeNull();
    // Low confidence holds the part at Developing, as the headline.
    expect(parts.businessQuality.confidence).toBe("LOW");
    expect(["EARLY", "DEVELOPING"]).toContain(parts.businessQuality.band);
    // The raise is on record but not graded against the stage: no number,
    // the count of factors on record (never 0, never the norm).
    expect(parts.readiness.score).toBeNull();
    expect(parts.readiness.factors.onRecord).toBeGreaterThan(0);
    expect(investabilityPartLines(view)?.[1]).toMatch(
      /^Investment readiness: \d+ of \d+ factors on record, not enough to grade yet$/u,
    );
    expect(investabilityPartLines(view)?.[0]).toMatch(
      /^Business quality \d+ · /u,
    );
  });

  it("a part with nothing graded has no number, never 0", () => {
    const { view } = assessInvestability(
      company({
        FOUNDERS: [fact("CEO", "Founded and sold a payments company")],
        MARKET: [fact("TAM", "$4B")],
        TRACTION: [fact("Monthly revenue", "USD 45,000 MRR")],
      }),
      AS_OF,
    );
    expect(view.parts?.readiness).toMatchObject({
      score: null,
      band: null,
      confidence: null,
      factors: { onRecord: 0 },
    });
    expect(investabilityPartLines(view)?.[1]).toBe(
      "Investment readiness: nothing shared yet",
    );
  });
});
