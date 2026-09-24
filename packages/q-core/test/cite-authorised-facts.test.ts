import { describe, expect, it } from "vitest";

import { citeAuthorisedFacts } from "../src/index.js";

/**
 * Capital Q's per-render fact labels never survive into an answer a person
 * reads (CQ-QX-005, ACC H3b: "(F3)" and "(F4)" printed in Q's prose).
 * Enforced where the answer is assembled, against the labels that render
 * actually issued — not by a word list over prose.
 */

const facts = [
  { ref: "F3", source: "your one-pager" },
  { ref: "F4", source: "what you told me" },
  { ref: "F5" },
];

describe("fact labels in an answer", () => {
  it("become the source they stand for", () => {
    expect(citeAuthorisedFacts("GMV in August was $412k (F3).", facts)).toBe(
      "GMV in August was $412k (your one-pager).",
    );
    expect(citeAuthorisedFacts("It was 380k, not 412k [F3, F4].", facts)).toBe(
      "It was 380k, not 412k (your one-pager; what you told me).",
    );
  });

  it("disappear when the fact has no source to name", () => {
    expect(citeAuthorisedFacts("Revenue is growing (F5).", facts)).toBe(
      "Revenue is growing.",
    );
  });

  it("leaves anything that is not a label this render issued", () => {
    const text = "The F150 fleet and F7 are unrelated; so is Form F-1.";
    expect(citeAuthorisedFacts(text, facts)).toBe(text);
    expect(citeAuthorisedFacts("Nothing to cite (F3).", [])).toBe(
      "Nothing to cite (F3).",
    );
  });

  it("never leaves a label pattern behind for any issued ref", () => {
    const out = citeAuthorisedFacts(
      "See F3 and (F4) and [F3; F5] and facts F4.",
      facts,
    );
    expect(out).not.toMatch(/\bF[345]\b/);
  });
});
