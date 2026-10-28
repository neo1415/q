import { describe, expect, it } from "vitest";

import {
  ANALYSIS_WRITE_DILIGENCE_RULE,
  ANALYSIS_WRITE_V3,
  ANALYSIS_WRITE_V4,
  JOB_PLAN_V13,
  JOB_PLAN_V14,
  RESEARCH_PLAN_DILIGENCE_RULE,
  RESEARCH_PLAN_V2,
  RESEARCH_PLAN_V3,
  V14_NAMED_COMPANY_KINDS,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Diligence audit 2026-10-28: a named-company memo was planned with no
 * research and written with a growth plan's sections.
 */
describe("diligence prompts", () => {
  it("JOB_PLAN v14 is active: v13 plus DUE DILIGENCE, the same result", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(14);
    expect(registry.get("JOB_PLAN", 13)?.definition.status).toBe("DEPRECATED");
    expect(JOB_PLAN_V14.output).toBe(JOB_PLAN_V13.output);
    expect(JOB_PLAN_V14.template).toContain(V14_NAMED_COMPANY_KINDS);
    expect(V14_NAMED_COMPANY_KINDS).toMatch(/a RESEARCH step/u);
    expect(V14_NAMED_COMPANY_KINDS).toMatch(/litigation/u);
  });

  it("RESEARCH_PLAN v3 and ANALYSIS_WRITE v4 are active on their predecessors' variables and results", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("RESEARCH_PLAN").definition.version).toBe(3);
    expect(registry.get("RESEARCH_PLAN", 2)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(RESEARCH_PLAN_V3.variables).toBe(RESEARCH_PLAN_V2.variables);
    expect(RESEARCH_PLAN_V3.output).toBe(RESEARCH_PLAN_V2.output);
    expect(RESEARCH_PLAN_V3.template).toContain(RESEARCH_PLAN_DILIGENCE_RULE);
    for (const lane of [
      "FOUNDERS_TEAM",
      "CUSTOMERS",
      "LITIGATION_REGULATORY",
      "FUNDING",
    ]) {
      expect(RESEARCH_PLAN_DILIGENCE_RULE).toContain(lane);
    }
    expect(registry.getActive("ANALYSIS_WRITE").definition.version).toBe(4);
    expect(registry.get("ANALYSIS_WRITE", 3)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(ANALYSIS_WRITE_V4.variables).toBe(ANALYSIS_WRITE_V3.variables);
    expect(ANALYSIS_WRITE_V4.output).toBe(ANALYSIS_WRITE_V3.output);
    expect(ANALYSIS_WRITE_V4.template).toContain(ANALYSIS_WRITE_DILIGENCE_RULE);
    expect(ANALYSIS_WRITE_DILIGENCE_RULE).toMatch(
      /Do not write Claims vs evidence, Sources or Not known sections/u,
    );
  });
});
