import { describe, expect, it } from "vitest";

import { asksAboutOthersInterest } from "@capital-q/model-gateway/q";

import {
  gradeOthersActivity,
  OTHERS_ACTIVITY_CASES,
} from "../src/datasets/others-activity/cases.js";

/**
 * The others'-activity dataset (audit 2026-11-13 item 17) and its grader,
 * at no cost: no provider is called. The live reading of these cases is
 * prepared, not run here.
 */
describe("the others'-activity dataset and grader ($0, no provider)", () => {
  it("is small, unique, and covers paraphrase, voice, French, Spanish, follow-ups and negatives", () => {
    const ids = OTHERS_ACTIVITY_CASES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    const asks = OTHERS_ACTIVITY_CASES.filter((one) => one.expected);
    expect(asks.filter((one) => !one.wordRule).length).toBeGreaterThanOrEqual(
      10,
    );
    expect(
      OTHERS_ACTIVITY_CASES.filter((one) => !one.expected).length,
    ).toBeGreaterThanOrEqual(5);
    for (const prefix of ["voice-", "fr-", "es-", "follow-", "neg-"]) {
      expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
    }
  });

  it("records truthfully which asks the word rule already catches", () => {
    for (const one of OTHERS_ACTIVITY_CASES) {
      expect(asksAboutOthersInterest(one.said), one.id).toBe(one.wordRule);
    }
  });

  it("grades by code", () => {
    expect(gradeOthersActivity(true, { othersActivity: true })).toBe(true);
    expect(gradeOthersActivity(false, {})).toBe(true);
    expect(gradeOthersActivity(true, {})).toBe("othersActivity false");
    expect(gradeOthersActivity(false, { othersActivity: true })).toBe(
      "othersActivity true",
    );
    expect(gradeOthersActivity(true, null)).toBe("not read");
  });
});
