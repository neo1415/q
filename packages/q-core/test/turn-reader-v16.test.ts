import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V15,
  TURN_READER_V16,
} from "../src/index.js";

/**
 * TURN_READER v16 (founder live 2026-09-30): "open my chat with Yamfield
 * Agro" landed on the Relationships list. A named record is not a whole
 * screen; the run opens it. Nothing of v15 is lost.
 */
describe("TURN_READER v16", () => {
  it("is the active reader and adds only the named-records rule to v15", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(35);
    expect(TURN_READER_V16.template).toContain(
      "NAMED RECORDS: NAVIGATE is only for a whole screen",
    );
    expect(
      TURN_READER_V16.template.replace(/NAMED RECORDS: [^\n]*\n/, ""),
    ).toBe(TURN_READER_V15.template);
  });
});
