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
      "arab investors from the region",
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
        "arab investors from the region",
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
        "arab investors from the region",
      ),
    ).toBeNull();
  });

  it("F-57: never searches by a region the turn did not say (an earlier rehearsal's Qatar), and leaves 'which investors should I talk to first?' to the full reading", () => {
    const skim = (
      regions: string[],
      sector: string | null = null,
    ): Parameters<typeof fastLaneOf>[0] => ({
      kind: "DISCOVER_INVESTORS",
      confidence: "HIGH",
      count: null,
      discover: null,
      person: null,
      investors: { regions, sector, stage: null, aboutMyCompany: true },
    });
    // The region came from the conversation, not from these words.
    expect(
      fastLaneOf(skim(["Qatar"]), "Which investors should I talk to first?"),
    ).toBeNull();
    // No region, sector or stage: which investors to approach, not a
    // search of a kind (the reader's INVESTOR_PROSPECTS answers it).
    expect(
      fastLaneOf(skim([]), "Which investors should I talk to first?"),
    ).toBeNull();
    expect(
      fastLaneOf(
        skim([]),
        "Which investors should I approach first for my raise, and why?",
      ),
    ).toBeNull();
    // Said in the turn, it is still a search of public investors.
    expect(
      fastLaneOf(skim(["Qatar"]), "Which investors in Qatar should I talk to?")
        ?.discoverInvestors?.regions,
    ).toEqual(["Qatar"]);
    expect(
      fastLaneOf(skim([], "fintech"), "fintech investors for us")?.questionKind,
    ).toBe("DISCOVER_INVESTORS");
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

describe("the first read's investor ask yields to their own question (any language)", () => {
  const skim = (regions: string[]) => ({
    kind: "DISCOVER_INVESTORS" as const,
    confidence: "HIGH" as const,
    count: null,
    discover: null,
    person: null,
    investors: { regions, sector: null, stage: null, aboutMyCompany: true },
  });

  it("English, Arabic and mixed turns asking about their amount wait for Q", () => {
    for (const [regions, said] of [
      [
        ["Gulf"],
        "We want to raise USD 1.5m from Gulf investors. Is that amount reasonable?",
      ],
      [
        ["الخليج"],
        "نريد جمع 1.5 مليون دولار من مستثمري الخليج. هل هذا المبلغ معقول؟",
      ],
      [
        ["Gulf"],
        "We want to raise USD 1.5m seed from Gulf investors. هل هذا المبلغ منطقي؟",
      ],
      [
        ["Golfe"],
        "Nous levons 1,5 M USD auprès d'investisseurs du Golfe. Ce montant est-il raisonnable ?",
      ],
    ] as const) {
      expect(fastLaneOf(skim([...regions]), said)).toBeNull();
    }
  });

  it("a question that is itself the search still goes to the list", () => {
    expect(
      fastLaneOf(
        skim(["Gulf"]),
        "We raise USD 1.5m. Which Gulf investors could fit?",
      )?.questionKind,
    ).toBe("DISCOVER_INVESTORS");
  });
});
