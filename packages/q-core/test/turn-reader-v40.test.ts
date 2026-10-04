import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V39,
  TURN_READER_V40,
  TURN_READER_V40_REFERENCES,
  TurnReaderV40ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v40 (follow-55, Zino live 2026-10-04): the one record a turn
 * asks to open, and a request to repeat Q's last action.
 */
describe("TURN_READER v40", () => {
  it("is the active reader and v39 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(40);
    expect(TURN_READER_V39.status).toBe("DEPRECATED");
  });

  it("adds only the REFERENCE words, in the static prefix before every per-turn value", () => {
    expect(
      TURN_READER_V40.template.replace(TURN_READER_V40_REFERENCES, ""),
    ).toBe(TURN_READER_V39.template);
    expect(TURN_READER_V40.template.indexOf("REFERENCE (")).toBeLessThan(
      TURN_READER_V40.template.indexOf("{{"),
    );
    // The founder's own phrasings are in it.
    for (const said of [
      "open the questions for Priya",
      "try again",
      "same for X",
    ]) {
      expect(TURN_READER_V40_REFERENCES).toContain(said);
    }
  });

  it("reads a reference, and an older reading without one still parses", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(TurnReaderV40ResultSchema.parse(base).reference).toBeNull();
    const read = TurnReaderV40ResultSchema.parse({
      ...base,
      reference: { open: "DOCUMENT", shown: 1, retryLast: false },
    });
    expect(read.reference).toEqual({
      open: "DOCUMENT",
      name: null,
      shown: 1,
      retryLast: false,
      sameFor: null,
    });
    expect(
      TurnReaderV40ResultSchema.safeParse({
        ...base,
        reference: { open: "SCREEN" },
      }).success,
    ).toBe(false);
  });
});
