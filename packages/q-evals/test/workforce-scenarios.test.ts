import { describe, expect, it } from "vitest";

import {
  JobPlanResultV5Schema,
  createDefaultPromptRegistry,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
  type JobPlanResultV5,
} from "@capital-q/q-core";

import {
  WORKFORCE_SCENARIOS,
  gradeWorkforce,
  plannerVariables,
  runWorkforceScenario,
} from "../src/index.js";

/**
 * Workforce intelligence scenarios with a scripted planner (wf 2026-10-16):
 * diligence prep, a GateQ follow-up, round prep for a founder, and a
 * contradiction found mid-task, each driven through the real engine and
 * scored on plan quality and task completion. No provider is called; the
 * live planner is graded against the same expectations by
 * scripts/evals/q-workforce/run.mjs.
 */

const PASS = 90;

describe("workforce scenarios (scripted planner, real engine)", () => {
  for (const scenario of WORKFORCE_SCENARIOS) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      // The scripted plan is a valid JOB_PLAN v5 answer.
      expect(JobPlanResultV5Schema.safeParse(scenario.scripted).success).toBe(true);
      const run = await runWorkforceScenario(scenario, () =>
        Promise.resolve(scenario.scripted),
      );
      expect(run).not.toBeNull();
      if (run === null) return;
      const grade = gradeWorkforce(scenario, run.plan, run);
      const failed = grade.checks.filter((check) => !check.ok);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(grade.score).toBeGreaterThanOrEqual(PASS);
    });
  }

  it("scores a weak plan low: no outcome, invented evidence, false dependencies, missing specialist", async () => {
    const [scenario] = WORKFORCE_SCENARIOS;
    if (scenario === undefined) throw new Error("no scenario");
    const weak: JobPlanResultV5 = {
      ...scenario.scripted,
      outcome: "Do it.",
      prerequisites: [
        { what: "Everything is in place", status: "MET", blocking: false, evidence: [], resolvedBy: null },
      ],
      nextActions: [],
      steps: [
        { key: "market", role: "RESEARCH", goal: "Research", tools: ["public_web.search"], dependsOn: [], why: "Research.", evidence: ["F42"], fallbackFor: null },
        { key: "memo", role: "DOCUMENTS", goal: "Memo", tools: ["documents.own.prepare"], dependsOn: ["market"], document: { operation: "PREPARE", kind: "MEMO", scope: "NAMED_COMPANY" }, why: "Memo.", evidence: ["F77"], fallbackFor: null },
      ],
    };
    const run = await runWorkforceScenario(scenario, () => Promise.resolve(weak));
    if (run === null) throw new Error("not planned");
    const grade = gradeWorkforce(scenario, run.plan, run);
    expect(grade.planScore).toBeLessThan(50);
    // Code still grounded it: the invented references never reached the plan.
    expect(run.plan.steps.flatMap((step) => step.evidence)).toEqual([]);
    expect(run.plan.reasoning?.prerequisites[0]?.status).toBe("UNKNOWN");
  });

  it("renders the real planner prompt with the situation fenced as data", () => {
    const [scenario] = WORKFORCE_SCENARIOS;
    if (scenario === undefined) throw new Error("no scenario");
    const rendered = renderPrompt(createDefaultPromptRegistry(), {
      task: "JOB_PLAN",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "You are planning, not acting.",
      variables: plannerVariables(scenario),
    });
    const text = JSON.stringify(rendered.messages);
    expect(text).toContain("F4 [OPEN_REQUEST] Open diligence request with Harbourline Cargo: Unit economics by lane.");
    expect(text).toMatch(/THINK IN THIS ORDER/u);
    // The situation is fenced as untrusted data, never instructions.
    expect(text).toContain('UNTRUSTED_CONTENT source=\\"situation\\"');
    expect(rendered.characters).toBeLessThan(40_000);
  });
});
