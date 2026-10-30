import { describe, expect, it } from "vitest";

import {
  PLAN_REVIEW_V4,
  PLAN_REVIEW_V5,
  PlanReviewResultV3Schema,
  REVIEW_REFS_V5,
  createDefaultPromptRegistry,
} from "../src/index.js";

const item = (score: number) => ({ score, defects: [] });

describe("PLAN_REVIEW v5 (plan job 32e70db7): every defect names its refs", () => {
  it("is active; the rubric and bar are v4's", () => {
    expect(
      createDefaultPromptRegistry().getActive("PLAN_REVIEW").versionId,
    ).toBe("plan-review/v5");
    expect(PLAN_REVIEW_V5.template).toContain(REVIEW_REFS_V5);
    expect(PLAN_REVIEW_V5.template).toContain("99/100");
    expect(PLAN_REVIEW_V4.template).not.toContain("refs are the refs");
    expect(PLAN_REVIEW_V5.output).toMatchObject({
      schemaVersion: 3,
      schema: PlanReviewResultV3Schema,
    });
  });

  it("refuses a defect without refs, accepts one with them", () => {
    const base = {
      situationCoverage: item(15),
      specificity: item(20),
      citesFacts: item(15),
      ownerClassification: item(10),
      feasibility: item(10),
      noInventedFacts: item(15),
      asksNothingKnown: item(10),
      roleCorrectWording: item(5),
      firewall: { held: true, defects: [] },
      score: 100,
    };
    const defect = {
      stepKey: null,
      problem: "No organisation-verification step.",
      fix: "Add one.",
    };
    const withDefect = (one: object) => ({
      ...base,
      situationCoverage: { score: 14, defects: [one] },
    });
    expect(
      PlanReviewResultV3Schema.safeParse(
        withDefect({ ...defect, refs: ["F53"] }),
      ).success,
    ).toBe(true);
    expect(PlanReviewResultV3Schema.safeParse(withDefect(defect)).success).toBe(
      false,
    );
  });
});
