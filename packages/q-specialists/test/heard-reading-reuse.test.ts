import { describe, expect, it } from "vitest";

import { heardReadingReusable } from "../src/answer.js";

type Reading = Parameters<typeof heardReadingReusable>[0];

const plainQuestion: Reading = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  tool: null,
};

describe("garbled speech: the first reading is reused for its likely words (live 18 Nov)", () => {
  it("reuses a plain question to Q: no second reader call", () => {
    expect(heardReadingReusable(plainQuestion)).toBe(true);
  });

  it("reads again when anything in the reading is bound to the garbled words", () => {
    const bound: readonly Reading[] = [
      { ...plainQuestion, askedAction: "send the email" },
      { ...plainQuestion, saveToOwnProfile: true },
      { ...plainQuestion, acceptsOffer: true },
      { ...plainQuestion, teamJob: true },
      { ...plainQuestion, kind: "TOOL_REQUEST" },
      { ...plainQuestion, confidence: "LOW" },
      { ...plainQuestion, addressedToQ: false },
    ];
    for (const reading of bound) {
      expect(heardReadingReusable(reading)).toBe(false);
    }
  });
});
