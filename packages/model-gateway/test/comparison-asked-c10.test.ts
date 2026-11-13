import { describe, expect, it } from "vitest";

import { comparisonAsked } from "../src/q/index.js";
import { asksToCompare } from "../src/q/compare-table.js";

/**
 * C10 (owner 13 Nov: semantic intent, not keyword routing; audit item 4).
 * The turn reader's reading decides whether a turn is a comparison; the
 * words decide only when there is no reading.
 */
describe("a comparison is what the reader read, not what the words match", () => {
  it("a comparison said without the word 'compare' is one, when the reader heard it", () => {
    for (const said of [
      "How do Ajopot and Ledgerline stack up against each other?",
      "Ajopot or Ledgerline: which looks stronger to you?",
      "Put Ajopot next to Ledgerline for me",
      "¿Cómo se comparan Ajopot y Ledgerline?",
    ]) {
      expect(
        comparisonAsked(
          {
            turnKind: "QUESTION_TO_Q",
            compare: { count: null, names: ["Ajopot", "Ledgerline"] },
          },
          said,
          asksToCompare,
        ),
      ).toBe(true);
    }
    expect(
      comparisonAsked(
        { turnKind: "QUESTION_TO_Q", answerKind: "COMPARISON" },
        "Which of the two is the better bet?",
        asksToCompare,
      ),
    ).toBe(true);
  });

  it("words that look like a comparison are not one when the reader read something else", () => {
    expect(
      comparisonAsked(
        { turnKind: "QUESTION_TO_Q", answerKind: "LOOKUP" },
        "Compare notes with me later: what stage is Ledgerline at?",
        asksToCompare,
      ),
    ).toBe(false);
  });

  it("with no reading (FAKE mode, a failed reader), the words are the bounded fallback", () => {
    expect(
      comparisonAsked(
        {},
        "Compare Ajopot and Ledgerline side by side",
        asksToCompare,
      ),
    ).toBe(asksToCompare("Compare Ajopot and Ledgerline side by side"));
  });
});
