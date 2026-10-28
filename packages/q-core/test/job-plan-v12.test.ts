import { describe, expect, it } from "vitest";

import {
  JOB_PLAN_V11,
  JOB_PLAN_V12,
  V12_BRIEF,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Production 2026-10-25 (run 341b8d61): a market-research plan was cut off
 * at its output ceiling and the retry kept no step. A plan is brief.
 */
describe("JOB_PLAN v12", () => {
  it("is active: v11 with BE BRIEF, the same result", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(14);
    expect(registry.get("JOB_PLAN", 11)?.definition.status).toBe("DEPRECATED");
    expect(JOB_PLAN_V12.output).toBe(JOB_PLAN_V11.output);
    expect(JOB_PLAN_V12.template).toBe(
      JOB_PLAN_V11.template.replace(
        "THINK IN THIS ORDER",
        `${V12_BRIEF}THINK IN THIS ORDER`,
      ),
    );
    expect(V12_BRIEF).toMatch(/one short sentence/u);
  });
});
