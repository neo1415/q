import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V29,
  TURN_READER_V30,
  TURN_READER_V30_ASKED_ACTION,
  TurnReaderV30ResultSchema,
} from "../src/index.js";

/** TURN_READER v30 (ADR 0040 parity): askedAction, a listed action's name. */
describe("TURN_READER v30", () => {
  it("v29 is deprecated (v31 is active)", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(31);
    expect(TURN_READER_V29.status).toBe("DEPRECATED");
  });

  it("adds the asked-action line and loses nothing of v29", () => {
    expect(TURN_READER_V30.template).toContain(TURN_READER_V30_ASKED_ACTION);
    for (const line of TURN_READER_V29.template.split("\n")) {
      expect(TURN_READER_V30.template).toContain(line);
    }
  });

  it("reads askedAction as null when a model leaves it out", () => {
    expect(
      TurnReaderV30ResultSchema.parse({
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
      }).askedAction,
    ).toBe(null);
  });
});
