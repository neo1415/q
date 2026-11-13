import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V78,
  TURN_READER_V79,
  TurnReaderV79ResultSchema,
  TurnReaderV86ResultSchema,
  V78_WHAT_WAS_ASKED,
  V79_REFERENCE_NAMES,
} from "../src/index.js";

/**
 * Live 2026-11-06 (QIQ-PRO-001): the people Q had just named had no LEDGER
 * entry, so "she" could point at no ref and Q asked who she was. v79 lets
 * a reference carry the name as written in RECENT TURNS.
 */
describe("TURN_READER v79", () => {
  const base = {
    kind: "QUESTION_TO_Q",
    transcript: "CLEAR",
    confidence: "HIGH",
  };

  it("is the active reader: v78 kept whole plus one REFERENCES BY NAME rule", () => {
    const active =
      createDefaultPromptRegistry().getActive("TURN_READER").definition;
    expect(active.version).toBe(86);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV86ResultSchema,
    );
    expect(
      TURN_READER_V79.template.replace(
        `${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}`,
        V78_WHAT_WAS_ASKED,
      ),
    ).toBe(TURN_READER_V78.template);
    expect(TURN_READER_V79.variables.untrusted).toContain("conversationState");
    for (const said of [
      "named",
      "exactly as written in RECENT TURNS",
      "never a name that is not written there",
      "one clear reading",
      "two entries only when two readings are both genuinely plausible",
      "always pointed at by its E ref",
    ]) {
      expect(V79_REFERENCE_NAMES).toContain(said);
    }
  });

  it("reads a reference with a name and its kind; a malformed name costs only the name", () => {
    const read = TurnReaderV79ResultSchema.parse({
      ...base,
      references: [
        {
          phrase: "she",
          entityIds: [],
          confidence: "HIGH",
          named: { name: "Ngozi Eze", kind: "PERSON" },
        },
        {
          phrase: "they",
          entityIds: ["E1"],
          confidence: "HIGH",
          named: { name: "Silo Credit", kind: "A_TEAM" },
        },
        { phrase: "it", entityIds: ["E2"] },
      ],
    });
    expect(read.references).toEqual([
      {
        phrase: "she",
        entityIds: [],
        confidence: "HIGH",
        named: { name: "Ngozi Eze", kind: "PERSON" },
      },
      { phrase: "they", entityIds: ["E1"], confidence: "HIGH", named: null },
      { phrase: "it", entityIds: ["E2"], confidence: "MEDIUM", named: null },
    ]);
  });
});
