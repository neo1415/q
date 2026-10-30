import { describe, expect, it } from "vitest";

import {
  JOB_PLAN_V12,
  JOB_PLAN_V13,
  V13_SPEAKING_TO_THEM,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA F-123 (2026-10-25, run d5bcb2eb): the start line said "you will
 * research Silo Credit's market". The summary names Q's own work.
 */
describe("JOB_PLAN v13", () => {
  it("is active: v12 with SPEAKING TO THEM reworded, the same result", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(16);
    expect(registry.get("JOB_PLAN", 12)?.definition.status).toBe("DEPRECATED");
    expect(JOB_PLAN_V13.output).toBe(JOB_PLAN_V12.output);
    expect(JOB_PLAN_V13.template).toContain(V13_SPEAKING_TO_THEM);
    expect(JOB_PLAN_V13.template).not.toContain("saying what you will do");
    expect(V13_SPEAKING_TO_THEM).toMatch(/never "you will"/u);
  });
});
