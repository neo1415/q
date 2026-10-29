import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  JOB_PLAN_V15,
  JOB_PLAN_V16,
  V16_PRIOR_NONE,
  V16_STEPS_LINE,
  createDefaultPromptRegistry,
  renderPrompt,
} from "../src/index.js";

/**
 * Live 2026-10-29 (sweep I16): a clear research request came back from the
 * lead as a plan object with no steps. v16 says a plan has steps, and what
 * "(none)" beside the job means.
 */
describe("JOB_PLAN v16", () => {
  it("is active, on v15's variables and result, saying a plan is never empty", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(16);
    expect(JOB_PLAN_V16.output).toBe(JOB_PLAN_V15.output);
    expect(JOB_PLAN_V16.variables).toBe(JOB_PLAN_V15.variables);
    const rendered = renderPrompt(registry, {
      task: "JOB_PLAN",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "test",
      variables: {
        goal: "Investigate the Nigerian B2B payments sector and give me an evidence-backed report.",
        roster: "RESEARCH: public_web.search",
        allowed: "Tools and actions: public_web.search.",
        situation: "Nothing on record was read for this job.",
      },
    })
      .messages.map((message) => message.content)
      .join("\n");
    expect(rendered).toContain(V16_STEPS_LINE);
    expect(rendered).toContain(V16_PRIOR_NONE);
    // No earlier answer: the section says so, never "(not provided)".
    expect(rendered).not.toContain("(not provided)");
  });
});
