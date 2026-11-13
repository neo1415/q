import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V80,
  TURN_READER_V81,
  TurnReaderV79ResultSchema,
  TurnReaderV82ResultSchema,
  V81_SINGLE_ASK,
  V81_SINGLE_ASK_FROM,
} from "../src/index.js";

/**
 * TURN_READER v81 (live Q-IQ run 2, FOLLOW_UPS): a single ask that leans
 * on earlier turns ("same question for Tamarind Pay") is one part, made
 * self-standing from the conversation, so the answer is told what is
 * asked now instead of rebuilding it (it anchored on the first question).
 */
describe("TURN_READER v81", () => {
  it("v80 with one sentence of the parts rule replaced (v82 is active)", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(82);
    expect(registry.get("TURN_READER", 80)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV82ResultSchema,
    );
    expect(TURN_READER_V81.variables).toEqual(TURN_READER_V80.variables);
    expect(TURN_READER_V80.template).toContain(V81_SINGLE_ASK_FROM);
    expect(TURN_READER_V81.template).not.toContain(V81_SINGLE_ASK_FROM);
    expect(
      TURN_READER_V81.template.replace(V81_SINGLE_ASK, V81_SINGLE_ASK_FROM),
    ).toBe(TURN_READER_V80.template);
  });

  it("restates an elliptical single ask, and 'same question' is the last one", () => {
    for (const said of [
      "A single ask that stands alone leaves parts empty",
      '"same question for Silo Health"',
      "is one part: ask is it made self-standing from RECENT TURNS",
      "asks X what they asked last, never their first question",
    ]) {
      expect(V81_SINGLE_ASK).toContain(said);
    }
  });

  it("parses a reading with one self-standing part", () => {
    const parsed = TurnReaderV79ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      answerKind: "LOOKUP",
      parts: [{ ask: "What's Tamarind Pay's monthly burn?", kind: "LOOKUP" }],
    });
    expect(parsed.parts).toEqual([
      { ask: "What's Tamarind Pay's monthly burn?", kind: "LOOKUP" },
    ]);
  });
});
