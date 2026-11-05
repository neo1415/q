import { describe, expect, it } from "vitest";

import { gateConversationSummary } from "../src/index.js";

/**
 * Q intelligence step 2: a model-written running summary is kept only when
 * every figure in it is in the turns it summarises or the summary before.
 */
describe("the running-summary gate", () => {
  const turns = [
    "What is Silo Credit's ARR?",
    "Silo Credit's ARR is $2.4M and its burn is 180,000 a month.",
  ];

  it("passes a summary whose figures were said, in any spelling", () => {
    expect(
      gateConversationSummary({
        summary:
          "They asked about Silo Credit: ARR 2.4 million, burn $180k a month, 3 questions so far.",
        sources: turns,
      }).kind,
    ).toBe("PASSED");
  });

  it("refuses a summary that mints a figure", () => {
    const outcome = gateConversationSummary({
      summary: "Silo Credit's ARR is $2.4M with 62% gross margin.",
      sources: turns,
    });
    expect(outcome).toMatchObject({
      kind: "REFUSED",
      reason: "UNGROUNDED_FIGURE",
      figures: ["62%"],
    });
  });

  it("accepts a figure carried from the previous revision, and refuses an empty one", () => {
    expect(
      gateConversationSummary({
        summary: "Runway 14 months (from earlier).",
        sources: ["Runway is 14 months."],
      }).kind,
    ).toBe("PASSED");
    expect(
      gateConversationSummary({ summary: "  ", sources: turns }),
    ).toMatchObject({
      kind: "REFUSED",
      reason: "EMPTY",
    });
  });
});
