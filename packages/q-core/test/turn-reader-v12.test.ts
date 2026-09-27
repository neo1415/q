import { describe, expect, it } from "vitest";

import {
  TURN_READER_V11,
  TURN_READER_V12,
  TurnReaderV11ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v12 (R30 #7): the Saved page is a destination the reader may
 * choose, so "show me what I saved" navigates there. v11's rules stay.
 */
describe("TURN_READER v12", () => {
  it("names SAVED once and keeps v11's rules", () => {
    expect(TURN_READER_V12.template.split("SAVED (").length - 1).toBe(1);
    expect(TURN_READER_V12.template).toContain("RELATIONSHIPS (");
    expect(TURN_READER_V12.template).toContain("SEQUENCE (null unless");
    expect(TURN_READER_V12.template.length).toBeGreaterThan(
      TURN_READER_V11.template.length,
    );
  });

  it("accepts NAVIGATE SAVED", () => {
    expect(
      TurnReaderV11ResultSchema.safeParse({
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: { kind: "NAVIGATE", destination: "SAVED" },
        sequence: null,
      }).success,
    ).toBe(true);
  });
});
