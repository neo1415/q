import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V21,
  TURN_READER_V22,
  TURN_READER_V22_HAND_OVER,
  TurnReaderV22ResultSchema,
} from "../src/index.js";

/** TURN_READER v22 (QA, founder live 2026-10-01): the hand-over intent. */
describe("TURN_READER v22", () => {
  it("is superseded by v23, and v21 is deprecated", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(34);
    expect(TURN_READER_V21.status).toBe("DEPRECATED");
  });

  it("keeps the rest of v21 and adds only the hand-over line", () => {
    expect(
      TURN_READER_V22.template.replace(TURN_READER_V22_HAND_OVER, ""),
    ).toBe(TURN_READER_V21.template);
    // Meaning, any language: the line describes intent, never phrases to match.
    expect(TURN_READER_V22_HAND_OVER).toContain("any language");
  });

  it("reads a hand-over as optional: a reading without it is none", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(TurnReaderV22ResultSchema.parse(base).handOver).toBeNull();
    expect(
      TurnReaderV22ResultSchema.parse({
        ...base,
        handOver: { kind: "MEETING", counterpartName: null },
      }).handOver,
    ).toEqual({ kind: "MEETING", counterpartName: null });
    expect(
      TurnReaderV22ResultSchema.safeParse({
        ...base,
        handOver: { kind: "SOMETHING_ELSE" },
      }).success,
    ).toBe(false);
  });
});
