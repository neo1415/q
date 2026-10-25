import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  JOB_PLAN_V10,
  JOB_PLAN_V11,
  V11_ONLY_WHAT_THEY_ASKED,
} from "../src/index.js";

/**
 * Coordinator decision (c), 2026-10-24: an investor's board task --
 * research and an analysis -- was planned with founder diligence questions
 * nobody asked for, so it became a card (live dc1b17c9).
 */
describe("JOB_PLAN v11", () => {
  it("is active, on v10's template and result, plus the rule", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(12);
    expect(registry.get("JOB_PLAN", 10)?.definition.status).toBe("DEPRECATED");
    expect(JOB_PLAN_V11.output).toBe(JOB_PLAN_V10.output);
    expect(JOB_PLAN_V11.template).toBe(
      JOB_PLAN_V10.template.replace(
        "THINK IN THIS ORDER",
        `${V11_ONLY_WHAT_THEY_ASKED}THINK IN THIS ORDER`,
      ),
    );
  });

  it("plans outward steps only when asked, by meaning, and keeps research or a document their own work", () => {
    expect(V11_ONLY_WHAT_THEY_ASKED).toContain("diligence.questions.prepare");
    expect(V11_ONLY_WHAT_THEY_ASKED).toContain("by what it means");
    expect(V11_ONLY_WHAT_THEY_ASKED).toContain("any language");
    expect(V11_ONLY_WHAT_THEY_ASKED).toContain("nextActions");
    expect(
      JOB_PLAN_V11.template.indexOf("ONLY WHAT THEY ASKED FOR"),
    ).toBeLessThan(JOB_PLAN_V11.template.indexOf("THINK IN THIS ORDER"));
  });
});
