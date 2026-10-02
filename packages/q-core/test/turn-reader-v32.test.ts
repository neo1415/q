import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V31,
  TURN_READER_V32,
  TURN_READER_V32_ACTIONS,
} from "../src/index.js";

/** TURN_READER v32 (speed, 2026-10-02): the grouped action list. */
describe("TURN_READER v32", () => {
  it("is the active reader and v31 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(35);
    expect(TURN_READER_V31.status).toBe("DEPRECATED");
  });

  it("reads the grouped list instead of the JSON list, and keeps every other line of v31", () => {
    expect(TURN_READER_V32.template).toContain(TURN_READER_V32_ACTIONS);
    expect(TURN_READER_V32.template).toContain("{{actionGroups}}");
    expect(TURN_READER_V32.template).not.toContain("{{actions}}");
    for (const line of TURN_READER_V31.template.split("\n")) {
      if (line === "{{actions}}") continue;
      expect(TURN_READER_V32.template).toContain(line);
    }
  });
});
