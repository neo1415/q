import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V9,
  TURN_READER_V10,
  TurnReaderV9ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v10 (R27): the Relationships page is a destination the
 * reader may choose, so "take me to my relationships" navigates there
 * rather than being told the screen doesn't exist. v9's rules stay.
 */
describe("TURN_READER v10", () => {
  it("names RELATIONSHIPS once and keeps v9's rules", () => {
    // v13 (R33) is the active reader now and carries v10's template.
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(28);
    expect(TURN_READER_V10.template.split("RELATIONSHIPS (").length - 1).toBe(
      1,
    );
    expect(TURN_READER_V10.template).toContain("moreDocuments");
    expect(TURN_READER_V10.template.length).toBeGreaterThan(
      TURN_READER_V9.template.length,
    );
  });

  it("accepts NAVIGATE RELATIONSHIPS", () => {
    expect(
      TurnReaderV9ResultSchema.safeParse({
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: { kind: "NAVIGATE", destination: "RELATIONSHIPS" },
      }).success,
    ).toBe(true);
  });
});
