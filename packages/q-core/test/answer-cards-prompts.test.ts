import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V17,
  CompanyAnalystV17ResultSchema,
  TURN_READER_V42,
  TURN_READER_V43,
  V17_CARDS_LINE,
  V43_PREPARE_HEAD,
} from "../src/index.js";

describe("no file unless asked (C5, TURN_READER v43)", () => {
  it("makes a document only when a file is asked for", () => {
    expect(TURN_READER_V43.template).toContain(V43_PREPARE_HEAD);
    expect(TURN_READER_V43.template).not.toContain(
      "they want Capital Q to produce a document now.",
    );
    expect(TURN_READER_V42.template).toContain("a comparison, a plan;");
    expect(TURN_READER_V43.template).not.toContain("a comparison, a plan;");
  });
});

describe("answer cards (C1, COMPANY_ANALYST v17)", () => {
  it("asks for answerCards instead of a table or comparison cards", () => {
    expect(COMPANY_ANALYST_V17.template).toContain(V17_CARDS_LINE);
    expect(COMPANY_ANALYST_V17.template).not.toContain(
      "also fill comparisonCards",
    );
  });

  it("parses a reading with cards and never asks the model for a number", () => {
    const shape = CompanyAnalystV17ResultSchema.shape.answerCards;
    const parsed = shape.parse({
      shape: "RANKED",
      title: "Top three",
      cards: [
        {
          name: "Norrland Grid",
          reasons: ["Seed round in range"],
          measures: [{ label: "Stage", level: "STRONG", value: "Seed" }],
        },
      ],
    });
    expect(parsed?.cards[0]).not.toHaveProperty("score");
    expect(parsed?.followUps).toEqual([]);
  });
});
