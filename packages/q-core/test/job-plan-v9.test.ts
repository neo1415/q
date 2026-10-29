import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  JOB_PLAN_V8,
  JOB_PLAN_V9,
  JobPlanResultV8Schema,
  JobPlanResultV9Schema,
} from "../src/index.js";

/**
 * QA F-78 (2026-10-24): an investor's "short 12-month plan" failed planning
 * outright on one refused answer; and the start line said "the person's
 * own company".
 */
const plan = {
  summary: "Research West African logistics and write your 12-month plan",
  outcome: "A 12-month plan for the fund's West Africa logistics thesis.",
  prerequisites: [],
  nextActions: [],
  cannot: [],
  firstRead: "x".repeat(1_500),
  steps: [
    {
      key: "plan",
      role: "DOCUMENTS",
      goal: "Write the plan",
      tools: ["documents.own.prepare"],
      dependsOn: [],
      // A scope that does not exist: the document is dropped, not the plan.
      document: { operation: "PREPARE", kind: "ANALYSIS", scope: "OWN_FUND" },
      why: "w".repeat(450),
      evidence: [],
      fallbackFor: null,
    },
  ],
};

describe("JOB_PLAN v9", () => {
  it("is built on v8 (v10, v11 and v12 keep its template; v13 rewords its summary rule, QA F-123) and says the summary to them", () => {
    expect(
      createDefaultPromptRegistry().getActive("JOB_PLAN").definition.version,
    ).toBe(16);
    expect(JOB_PLAN_V9.template).toContain("in the second person");
    expect(JOB_PLAN_V9.template).toContain('never "the person"');
    expect(JOB_PLAN_V9.template.length).toBeGreaterThan(
      JOB_PLAN_V8.template.length,
    );
  });

  it("keeps the plan when only a lenient part is malformed (v8 refused it whole)", () => {
    expect(JobPlanResultV8Schema.safeParse(plan).success).toBe(false);
    const parsed = JobPlanResultV9Schema.safeParse(plan);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.firstRead).toBeNull();
    expect(parsed.data.steps[0]?.document).toBeUndefined();
    expect(parsed.data.steps[0]?.why).toHaveLength(450);
  });

  it("still refuses a plan whose core is malformed", () => {
    expect(
      JobPlanResultV9Schema.safeParse({ ...plan, steps: "none" }).success,
    ).toBe(false);
  });
});
