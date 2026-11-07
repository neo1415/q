import { describe, expect, it } from "vitest";

import {
  CompanyScoresDtoSchema,
  notAssessedInvestability,
} from "@capital-q/contracts";

import { companyScoresText } from "../src/fit/service.js";

/**
 * Audit P1-7: Q repeats Investability's two parts in the screen's own
 * words (investabilityPartLines), never a blended or invented figure.
 */
describe("companyScoresText: Investability's parts", () => {
  const base = {
    ...notAssessedInvestability("investiq/v3+investability-inputs.v6"),
    status: "SCORED" as const,
    score: 58,
    band: "DEVELOPING" as const,
    confidence: "LOW" as const,
    cappedByConfidence: true,
    coverage: {
      areasScored: 3,
      areasTotal: 8,
      criteriaScored: 13,
      criteriaApplicable: 48,
    },
  };

  it("says both parts as the screen does", () => {
    const text = companyScoresText(
      CompanyScoresDtoSchema.parse({
        companyId: "c0000000-0000-4000-8000-000000000001",
        investability: {
          ...base,
          parts: {
            businessQuality: {
              score: 64,
              band: "DEVELOPING",
              confidence: "LOW",
              factors: { onRecord: 9, applicable: 25 },
            },
            readiness: {
              score: null,
              band: null,
              confidence: null,
              factors: { onRecord: 3, applicable: 23 },
            },
          },
        },
        suitability: null,
      }),
    );
    expect(text).toContain("Business quality 64 · Developing · Low confidence");
    expect(text).toContain(
      "Investment readiness: 3 of 23 factors on record, not enough to grade yet",
    );
  });

  it("says nothing about parts an older assessment did not record", () => {
    const text = companyScoresText(
      CompanyScoresDtoSchema.parse({
        companyId: "c0000000-0000-4000-8000-000000000001",
        investability: base,
        suitability: null,
      }),
    );
    expect(text).not.toContain("Business quality");
  });
});
