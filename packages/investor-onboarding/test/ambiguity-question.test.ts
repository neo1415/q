import { describe, expect, it } from "vitest";

import type { MandateAmbiguity } from "../src/intelligence/contracts.js";

import { ambiguityQuestion } from "../src/integration/mandate-review-service.js";

/**
 * An ambiguity is asked in words that name what is open. The synthesis
 * prompt gives the model one example question (about exclusion), and a
 * model sometimes repeats it for a range or a phrase; the service never
 * lets that misdescribe the question (CQ-PRE-REC-001 §44).
 */
describe("ambiguityQuestion", () => {
  const base: Pick<MandateAmbiguity, "quote" | "question"> = {
    quote: "between 1 and 3 million dollars",
    question: "Should Capital Q exclude these entirely, or show them lower?",
  };

  it("asks a typical-or-limit range as a range, never as an exclusion", () => {
    const question = ambiguityQuestion({
      ...base,
      dimension: "cheque_max",
      kind: "TYPICAL_OR_LIMIT",
    });
    expect(question).toBe(
      "You wrote “between 1 and 3 million dollars”. Is that your largest cheque as a rule, or a limit you never go past?",
    );
    expect(question).not.toMatch(/exclude/i);
  });

  it("keeps the model question for a scope-or-exclusion ambiguity", () => {
    expect(
      ambiguityQuestion({
        ...base,
        quote: "no crypto",
        dimension: "sectors",
        kind: "SCOPE_OR_EXCLUSION",
      }),
    ).toBe(base.question);
  });

  it("replaces a repeated exclusion template on an imprecise value, and keeps a real question", () => {
    expect(
      ambiguityQuestion({
        ...base,
        quote: "early stage",
        dimension: "stages",
        kind: "IMPRECISE_VALUE",
      }),
    ).toBe(
      "You wrote “early stage”. Which stages do you mean? It reads more than one way.",
    );
    expect(
      ambiguityQuestion({
        quote: "early stage",
        question: "Does early stage mean pre-seed, seed, or both?",
        dimension: "stages",
        kind: "IMPRECISE_VALUE",
      }),
    ).toBe("Does early stage mean pre-seed, seed, or both?");
  });
});
