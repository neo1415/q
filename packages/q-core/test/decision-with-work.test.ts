import { describe, expect, it } from "vitest";

import {
  JOB_PLAN_V7,
  TURN_READER_V51,
  V51_DECISION_WITH_WORK,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * wf, live 2026-10-16: a relationship decision stated with a request for
 * work was recorded instead of the work. The reader reads such a turn as a
 * team job, and the lead carries the decision as the person's next action.
 */
describe("a decision stated with work attached", () => {
  it("is a team job for the active turn reader, and a decision alone is not", () => {
    const registry = createDefaultPromptRegistry();
    // v52 (lane ml nextSteps) is built on v51 and keeps this rule.
    expect(registry.getActive("TURN_READER").definition.version).toBe(58);
    expect(registry.getActive("TURN_READER").definition.template).toContain(
      V51_DECISION_WITH_WORK,
    );
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(7);
    expect(TURN_READER_V51.template).toContain(V51_DECISION_WITH_WORK);
    expect(V51_DECISION_WITH_WORK).toMatch(/teamJob is true/u);
    expect(V51_DECISION_WITH_WORK).toMatch(
      /A decision stated on its own, with no work asked for, is not a team job/u,
    );
  });

  it("is carried by the lead as the first next action, never a step, and prerequisites are not step outputs", () => {
    expect(JOB_PLAN_V7.status).toBe("ACTIVE");
    expect(JOB_PLAN_V7.template).toContain(
      "make it the first next action with tool relationship.outcome.change",
    );
    expect(JOB_PLAN_V7.template).toContain("never list a step's own output");
    expect(JOB_PLAN_V7.template).not.toContain(
      "Never mark MET without a fact.\n",
    );
  });
});
