import { describe, expect, it } from "vitest";

import { INVESTABILITY_CURRENT_METHOD_VERSION } from "@capital-q/contracts";

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
      "investiq/v3+investability-inputs.v5",
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
