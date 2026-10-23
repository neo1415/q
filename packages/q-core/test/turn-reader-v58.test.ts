import { describe, expect, it } from "vitest";

import {
  TURN_READER_V57,
  TURN_READER_V58,
  TurnReaderV58ResultSchema,
  V1_ABOUT_NAMED_OTHER,
  V58_NAMED_OTHER,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Production 2026-10-23: "Yes", said to Q's offer about a company, was
 * searched and pictured as a company called "Yes". The reader now says
 * whom the turn is about, by meaning and from the conversation; code
 * guesses no name from capital letters or word lists.
 */
describe("TURN_READER v58: the reader names whom the turn is about", () => {
  it("is the active reader, v57 kept whole plus the NAMED OTHER rule", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(58);
    expect(TURN_READER_V57.status).toBe("DEPRECATED");
    expect(TURN_READER_V58.template).toContain(
      `${V1_ABOUT_NAMED_OTHER}${V58_NAMED_OTHER}`,
    );
    expect(TURN_READER_V58.template.replace(V58_NAMED_OTHER, "")).toBe(
      TURN_READER_V57.template,
    );
  });

  it("asks for the subject from meaning and the recent turns, never from a reply word", () => {
    expect(V58_NAMED_OTHER).toMatch(/from the recent turns/u);
    expect(V58_NAMED_OTHER).toMatch(/a yes to Q's offer about them/u);
    expect(V58_NAMED_OTHER).toMatch(/never a word of a reply/u);
    expect(V58_NAMED_OTHER).toMatch(/"zino aviation" is "Zino Aviation"/u);
  });

  it("keeps aboutNamedOther, and a malformed subject costs only the subject", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      aboutNamedOther: true,
    };
    expect(
      TurnReaderV58ResultSchema.parse({
        ...base,
        namedOther: { name: "Zino Aviation", kind: "COMPANY" },
      }).namedOther,
    ).toEqual({ name: "Zino Aviation", kind: "COMPANY" });
    const malformed = TurnReaderV58ResultSchema.parse({
      ...base,
      namedOther: { name: "", kind: "ROBOT" },
    });
    expect(malformed.namedOther).toBeNull();
    expect(malformed.aboutNamedOther).toBe(true);
    expect(TurnReaderV58ResultSchema.parse(base).namedOther).toBeNull();
  });
});
