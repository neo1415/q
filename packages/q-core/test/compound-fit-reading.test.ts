import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V49,
  TURN_READER_V50,
  TURN_SKIM_V4,
  TURN_SKIM_V5,
  V50_FIT,
  V5_COMPOUND_FIT,
} from "../src/index.js";

// Routing tests elsewhere consume stubbed readings. These assertions pin
// the real instructions supplying those readings; no provider calls.
describe("compound fit meaning in the existing readers", () => {
  it("publishes new versions without rewriting historical prompts", () => {
    const registry = createDefaultPromptRegistry();
    // v52 (lane ml nextSteps) on v51 (decision with work) keeps v50's compound-fit rule.
    expect(registry.getActive("TURN_READER").definition.version).toBe(75);
    expect(registry.getActive("TURN_READER").definition.template).toContain(
      V50_FIT,
    );
    expect(TURN_READER_V50.status).toBe("DEPRECATED");
    // v6 (subject) and v7 (writes) keep v5's compound-fit rule whole.
    expect(registry.getActive("TURN_SKIM").definition.version).toBe(9);
    expect(registry.getActive("TURN_SKIM").definition.template).toContain(
      V5_COMPOUND_FIT,
    );
    expect(TURN_SKIM_V5.status).toBe("DEPRECATED");
    expect(TURN_READER_V49.status).toBe("DEPRECATED");
    expect(TURN_SKIM_V4.status).toBe("DEPRECATED");
    expect(TURN_READER_V50.template.split(V50_FIT)).toHaveLength(2);
    expect(TURN_SKIM_V5.template.split(V5_COMPOUND_FIT)).toHaveLength(2);
    expect(V50_FIT).toContain("THEIR_OWN_RECORDS");
    expect(V5_COMPOUND_FIT).toContain("return OTHER");
    expect(V50_FIT).toContain(
      '"Which companies fit my mandate and why?" remains FIT',
    );
    expect(V5_COMPOUND_FIT).toContain(
      '"Which companies fit my mandate and why?" remains FIT',
    );
  });
});
