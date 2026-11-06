import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V77,
  TURN_READER_V78,
  TurnReaderV75ResultSchema,
  TurnReaderV78ResultSchema,
  TurnReaderV79ResultSchema,
  V77_REFERENCES,
  V78_WHAT_WAS_ASKED,
} from "../src/index.js";

/**
 * Q intelligence step 4: one source of truth for "what was asked". The
 * reader says the heaviest work the turn asks (answerKind) and each part of
 * a compound ask; code reads those fields instead of word lists.
 */
describe("TURN_READER v78", () => {
  const base = {
    kind: "QUESTION_TO_Q",
    transcript: "CLEAR",
    confidence: "HIGH",
  };

  it("is v77 kept whole plus one WHAT WAS ASKED rule (v79 is active, on its schema)", () => {
    const active =
      createDefaultPromptRegistry().getActive("TURN_READER").definition;
    expect(active.version).toBe(79);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV79ResultSchema,
    );
    expect(
      TURN_READER_V78.template.replace(
        `${V77_REFERENCES}${V78_WHAT_WAS_ASKED}`,
        V77_REFERENCES,
      ),
    ).toBe(TURN_READER_V77.template);
    expect(TURN_READER_V78.variables.untrusted).toContain("conversationState");
    for (const said of [
      "answerKind",
      "COMPARISON",
      "ANALYSIS",
      "DOCUMENT",
      "A word alone never decides it",
      "three parts",
      "second person",
      "remember to send the deck",
      "asksForChart",
      "asksForWeb",
    ]) {
      expect(V78_WHAT_WAS_ASKED).toContain(said);
    }
  });

  it("reads answerKind and parts; a single ask has neither", () => {
    const read = TurnReaderV78ResultSchema.parse({
      ...TurnReaderV75ResultSchema.parse(base),
      answerKind: "LOOKUP",
      parts: [
        { ask: "What's Silo Credit's ARR?", kind: "LOOKUP" },
        { ask: "Who is Silo Credit's CEO?", kind: "LOOKUP" },
      ],
    });
    expect(read.answerKind).toBe("LOOKUP");
    expect(read.parts.map((part) => part.ask)).toEqual([
      "What's Silo Credit's ARR?",
      "Who is Silo Credit's CEO?",
    ]);
    const single = TurnReaderV78ResultSchema.parse(
      TurnReaderV75ResultSchema.parse(base),
    );
    expect(single.answerKind).toBeNull();
    expect(single.parts).toEqual([]);
    expect(single.remember).toBeNull();
    expect(single.asksForChart).toBe(false);
    expect(single.asksForWeb).toBe(false);
  });

  it("reads a remember ask said back in the second person, and a chart ask", () => {
    const read = TurnReaderV78ResultSchema.parse({
      ...TurnReaderV75ResultSchema.parse(base),
      remember: { fact: "you pass on gambling businesses" },
      asksForChart: true,
    });
    expect(read.remember).toEqual({ fact: "you pass on gambling businesses" });
    expect(read.asksForChart).toBe(true);
    expect(
      TurnReaderV78ResultSchema.parse({
        ...TurnReaderV75ResultSchema.parse(base),
        remember: {},
      }).remember,
    ).toEqual({ fact: null });
  });

  it("a malformed answerKind or part costs itself, never the reading", () => {
    const read = TurnReaderV78ResultSchema.parse({
      ...TurnReaderV75ResultSchema.parse(base),
      answerKind: "DEEP_THOUGHT",
      parts: [{ ask: "", kind: "LOOKUP" }],
      remember: { fact: 7 },
      asksForChart: "yes",
    });
    expect(read.remember).toBeNull();
    expect(read.asksForChart).toBe(false);
    expect(read.kind).toBe("QUESTION_TO_Q");
    expect(read.answerKind).toBeNull();
    expect(read.parts).toEqual([]);
  });
});
