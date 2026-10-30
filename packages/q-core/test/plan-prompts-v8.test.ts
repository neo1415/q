import { describe, expect, it } from "vitest";

import {
  PLAN_REVIEW_V7,
  PLAN_REVIEW_V8,
  PlanReviewResultV4Schema,
  REVIEW_FEASIBILITY_V6,
  REVIEW_COVERAGE_V7,
  REVIEW_NOTE_V7,
  REVIEW_NOTE_V8,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Live 2026-10-30 (plan job 0823a533, plan 93bfe2e4): step 3, "Approve,
 * change or decline the proposed initial meeting with Aster Africa
 * Ventures", read "The meeting with Aster is waiting for your decision
 * before it can be booked." -- the step's own status, which under its
 * title says nothing is missing. v7's own example was such a line.
 */
describe("PLAN_REVIEW v8 (plan job 0823a533)", () => {
  it("is active on v4's output schema, with v7's rubric, bar and coverage", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("PLAN_REVIEW").versionId).toBe("plan-review/v8");
    expect(PLAN_REVIEW_V8.output).toBe(PLAN_REVIEW_V7.output);
    expect(PLAN_REVIEW_V8.output).toMatchObject({
      schema: PlanReviewResultV4Schema,
    });
    for (const kept of [
      "99/100",
      "plan-rubric/v1",
      REVIEW_FEASIBILITY_V6,
      REVIEW_COVERAGE_V7,
      REVIEW_NOTE_V8,
    ]) {
      expect(PLAN_REVIEW_V8.template).toContain(kept);
    }
    expect(PLAN_REVIEW_V8.template).not.toContain(REVIEW_NOTE_V7);
  });

  it("asks for what the step lacks, never only its own status; the restating example is gone", () => {
    expect(REVIEW_NOTE_V8).toContain("still missing or wrong");
    expect(REVIEW_NOTE_V8).toContain(
      "Never only what the step already is or says",
    );
    expect(REVIEW_NOTE_V7).toContain(
      "Nothing yet decides the meeting with Aster Africa Ventures that is already waiting for you.",
    );
    expect(REVIEW_NOTE_V8).not.toContain("Nothing yet decides the meeting");
    expect(REVIEW_NOTE_V8).toContain("A firewall defect has no note.");
  });
});
