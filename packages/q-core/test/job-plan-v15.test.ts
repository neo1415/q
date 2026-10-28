import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  JOB_PLAN_V14,
  JOB_PLAN_V15,
  V15_PRIOR_ANSWER,
  createDefaultPromptRegistry,
  renderPrompt,
} from "../src/index.js";

/**
 * Live 2026-10-28 (run 8b649d10): "make it into a plan and execute it"
 * after Q's gap analysis was planned without the gaps. Q's earlier answer
 * now travels beside the job, fenced and labelled as Q's inference.
 */
describe("JOB_PLAN v15", () => {
  const variables = {
    goal: "Can you make it into a plan and then go ahead and execute that plan for me",
    roster: "RESEARCH: research.web",
    allowed: "Tools and actions: research.web.",
    situation: "F1 Their company: TensorGate.",
  };
  const render = (extra: Record<string, unknown>) =>
    renderPrompt(createDefaultPromptRegistry(), {
      task: "JOB_PLAN",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "test",
      variables: { ...variables, ...extra },
    })
      .messages.map((message) => message.content)
      .join("\n");

  it("is active on v14's result, with Q's earlier answer before the job", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(15);
    expect(JOB_PLAN_V15.output).toBe(JOB_PLAN_V14.output);
    expect(JOB_PLAN_V15.variables.untrusted).toContain("priorAnswer");
    expect(JOB_PLAN_V15.template).toContain(V15_PRIOR_ANSWER);
    expect(JOB_PLAN_V15.template.indexOf(V15_PRIOR_ANSWER)).toBeLessThan(
      JOB_PLAN_V15.template.indexOf("THE JOB\n{{goal}}"),
    );
    expect(V15_PRIOR_ANSWER).toMatch(/your inference, not verified fact/u);
  });

  it("renders the earlier answer fenced as untrusted, and (none) without one", () => {
    const withAnswer = render({
      priorAnswer: "1. No audited financials\n2. No customer references",
    });
    expect(withAnswer).toContain("No audited financials");
    expect(withAnswer).toMatch(/UNTRUSTED_CONTENT[^\n]*priorAnswer/u);
    expect(render({})).toContain("(none)");
  });
});
