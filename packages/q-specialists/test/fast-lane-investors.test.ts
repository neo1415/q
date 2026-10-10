import { TurnSkimResultSchema } from "@capital-q/q-core";
import { describe, expect, it } from "vitest";

import { fastLaneOf } from "../src/fast-lane.js";

const INVESTORS = {
  regions: ["Arab"],
  sector: null,
  stage: null,
  aboutMyCompany: true,
};

describe("fastLaneOf (D1 investor discovery)", () => {
  it("routes a HIGH-confidence investor ask to code, region words as said", () => {
    expect(
      fastLaneOf(
        {
          kind: "DISCOVER_INVESTORS",
          confidence: "HIGH",
          count: 3,
          discover: null,
          person: null,
          investors: INVESTORS,
        },
        "i need top three arab investors that may be interested in this",
      ),
    ).toEqual({
      questionKind: "DISCOVER_INVESTORS",
      discoverInvestors: {
        regions: ["Arab"],
        sector: null,
        stage: null,
        count: 3,
        aboutMyCompany: true,
      },
    });
  });

  it("caps the count at five and waits when not sure or when nothing was read", () => {
    const lane = fastLaneOf(
      {
        kind: "DISCOVER_INVESTORS",
        confidence: "HIGH",
        count: 40,
        discover: null,
        person: null,
        investors: INVESTORS,
      },
      "investors from the region",
    );
    expect(lane?.discoverInvestors?.count).toBe(5);
    expect(
      fastLaneOf(
        {
          kind: "DISCOVER_INVESTORS",
          confidence: "MEDIUM",
          count: 3,
          discover: null,
          person: null,
          investors: INVESTORS,
        },
        "investors from the region",
      ),
    ).toBeNull();
    expect(
      fastLaneOf(
        {
          kind: "DISCOVER_INVESTORS",
          confidence: "HIGH",
          count: 3,
          discover: null,
          person: null,
          investors: null,
        },
        "investors from the region",
      ),
    ).toBeNull();
  });

  it("the skim contract takes the new kind and region words, and refuses extras", () => {
    const parsed = TurnSkimResultSchema.safeParse({
      kind: "DISCOVER_INVESTORS",
      confidence: "HIGH",
      count: 3,
      investors: { regions: ["Gulf"], sector: "fintech", stage: null },
    });
    expect(parsed.success).toBe(true);
    expect(
      TurnSkimResultSchema.safeParse({
        kind: "DISCOVER_INVESTORS",
        confidence: "HIGH",
        investors: { regions: [], cash: 5 },
      }).success,
    ).toBe(false);
  });
});
