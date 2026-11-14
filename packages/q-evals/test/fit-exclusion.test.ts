import { describe, expect, it } from "vitest";

import {
  FIT_EXCLUSION_CASES,
  gradeFitExclusion,
} from "../src/datasets/fit-exclusion/cases.js";

/**
 * D1 fit-exclusion dataset and grader, offline ($0, no provider): the
 * cases TURN_READER v88's `question.excludeRelationships` must read.
 */
describe("the fit-exclusion dataset and grader", () => {
  it("covers the live case, paraphrases, voice, two languages and negatives", () => {
    const cases = FIT_EXCLUSION_CASES;
    expect(new Set(cases.map((one) => one.id)).size).toBe(cases.length);
    expect(cases.some((one) => one.id.startsWith("live-"))).toBe(true);
    expect(
      cases.filter((one) => one.modality === "VOICE").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      cases.filter((one) => /spanish|french/u.test(one.id)).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      cases.filter((one) => !one.expected.excludeRelationships).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("grades by the typed reading, never by the words", () => {
    const expected = { kinds: ["FIT"] as const, excludeRelationships: true };
    expect(
      gradeFitExclusion(expected, {
        question: { kind: "FIT", excludeRelationships: true },
      }),
    ).toBe(true);
    expect(gradeFitExclusion(expected, { question: { kind: "FIT" } })).toBe(
      "excludeRelationships false",
    );
    expect(
      gradeFitExclusion(expected, {
        question: { kind: "ADVICE", excludeRelationships: true },
      }),
    ).toBe("kind ADVICE");
    expect(gradeFitExclusion(expected, null)).toBe("not read");
  });
});
