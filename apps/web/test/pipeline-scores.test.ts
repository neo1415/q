import { describe, expect, it } from "vitest";

import type {
  CompanyScoresDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import {
  listOrdered,
  listSortOf,
  pipelineScoresOf,
  rankBySuitability,
} from "../src/features/relationships/pipeline-scores";

/**
 * Owner 2026-10-17: the investor's Pipeline ranks by Suitability by
 * default. Scores are read, never computed; unknown is never 0 and always
 * ranks after every known value.
 */

const investability = (
  status: CompanyScoresDto["investability"]["status"],
  score: number | null,
): CompanyScoresDto["investability"] => ({
  status,
  score,
  band: score === null ? null : "INVESTABLE",
  confidence: score === null ? null : "MODERATE",
  cappedByConfidence: false,
  coverage: {
    areasScored: 5,
    areasTotal: 8,
    criteriaScored: 10,
    criteriaApplicable: 20,
  },
  stage: null,
  up: [],
  down: [],
  missing: [],
  methodVersion: "investiq/v1",
  assessedAt: null,
});

const suitability = (
  status: NonNullable<CompanyScoresDto["suitability"]>["status"],
  score: number | null,
): NonNullable<CompanyScoresDto["suitability"]> => ({
  status,
  score,
  band: "GOOD_FIT",
  confidence: "MEDIUM",
  coverage: { known: 3, applicable: 5 },
  up: [],
  down: [],
  missing: [],
  configVersion: "fit/v1",
});

const row = (n: number, stateSince: string): RelationshipSummaryDto => ({
  relationshipId: `a0000000-0000-4000-8000-00000000000${String(n)}`,
  counterpart: {
    kind: "COMPANY",
    id: `c0000000-0000-4000-8000-00000000000${String(n)}`,
    name: `Company ${String(n)}`,
  },
  state: "CONNECTED",
  stateSince,
  nextStep: "SCHEDULE_MEETING",
});

describe("pipeline scores", () => {
  it("reads the two scores from the DTO and keeps unscored as unknown", () => {
    const companyId = "c0000000-0000-4000-8000-000000000001";
    expect(
      pipelineScoresOf({
        companyId,
        investability: investability("SCORED", 64),
        suitability: suitability("SCORED", 80),
      }),
    ).toEqual({ suitability: 80, investability: 64 });
    expect(
      pipelineScoresOf({
        companyId,
        investability: investability("INSUFFICIENT_EVIDENCE", null),
        suitability: suitability("NOT_ENOUGH_INFORMATION", null),
      }),
    ).toEqual({ suitability: null, investability: null });
    // No mandate: no suitability at all, still not 0.
    expect(
      pipelineScoresOf({
        companyId,
        investability: investability("SCORED", 50),
        suitability: null,
      }),
    ).toEqual({ suitability: null, investability: 50 });
    expect(pipelineScoresOf(undefined)).toEqual({
      suitability: null,
      investability: null,
    });
  });

  it("ranks highest first, unknown last, ties in their incoming order", () => {
    const rows = [
      { id: "unknown-a", s: null },
      { id: "low", s: 0 },
      { id: "high", s: 90 },
      { id: "tie-1", s: 70 },
      { id: "unknown-b", s: null },
      { id: "tie-2", s: 70 },
    ];
    expect(rankBySuitability(rows, (r) => r.s).map((r) => r.id)).toEqual([
      "high",
      "tie-1",
      "tie-2",
      // A real 0 is a known score and ranks above unknown.
      "low",
      "unknown-a",
      "unknown-b",
    ]);
  });

  it("orders the List by suitability by default for an investor, else by time", () => {
    const older = row(1, "2026-10-01T00:00:00.000Z");
    const newer = row(2, "2026-10-10T00:00:00.000Z");
    const unscored = row(3, "2026-10-15T00:00:00.000Z");
    const scores = {
      [older.counterpart.id]: { suitability: 85, investability: 40 },
      [newer.counterpart.id]: { suitability: 60, investability: null },
    };
    const names = (list: readonly RelationshipSummaryDto[]) =>
      list.map((item) => item.counterpart.name);
    expect(
      names(listOrdered([newer, unscored, older], scores, "suitability")),
    ).toEqual(["Company 1", "Company 2", "Company 3"]);
    expect(
      names(listOrdered([newer, unscored, older], scores, "recent")),
    ).toEqual(["Company 3", "Company 2", "Company 1"]);

    expect(listSortOf(undefined, "INVESTOR")).toBe("suitability");
    expect(listSortOf("recent", "INVESTOR")).toBe("recent");
    expect(listSortOf("name", "INVESTOR")).toBe("suitability");
    // A founder has no suitability to rank by.
    expect(listSortOf(undefined, "COMPANY")).toBe("recent");
  });
});
