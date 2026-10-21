import { describe, expect, it } from "vitest";

import { outputSplitOf } from "../src/q/output-split.js";

describe("an answer's output split (counts only)", () => {
  it("measures each part, the rest as other", () => {
    const value = {
      answer: "Seed stage, steady growth.",
      responseShape: "ANALYTICAL",
      findings: [
        {
          type: "TRACTION",
          statement: "Revenue grew.",
          basis: ["F1", "the company's own figures"],
        },
      ],
      answerCards: { shape: "RANKED", title: "Top", cards: [] },
      gestures: [{ sentence: 0, gesture: "NOD" }],
    };
    const split = outputSplitOf(value);
    expect(split.total).toBe(JSON.stringify(value).length);
    expect(split.answer).toBe(JSON.stringify(value.answer).length);
    expect(split.findingsBasis).toBe(
      JSON.stringify(value.findings[0]?.basis).length,
    );
    expect(
      split.answer +
        split.findings +
        split.cards +
        split.gestures +
        split.other,
    ).toBeLessThanOrEqual(split.total);
    // Nothing but numbers.
    expect(Object.values(split).every((n) => typeof n === "number")).toBe(true);
  });
});
