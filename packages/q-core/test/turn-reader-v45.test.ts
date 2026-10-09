import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  INITIAL_CONVERSATION_STATE,
  readingFromTurnReader,
  researchDirectiveFor,
  TURN_READER_V44,
  TURN_READER_V45,
  TurnReaderV45ResultSchema,
  V45_FIT,
  V45_STILL_WAITING,
} from "../src/index.js";

/**
 * TURN_READER v45 (Zino live 2026-10-09 07:29-07:32): "give me three good
 * examples of companies I can invest in" was read as ADVICE and researched
 * on the public web for 23-30 s. Which companies they could invest in is
 * FIT in any words, with its count, and never researched; "still waiting"
 * is the unanswered ask again.
 */
describe("TURN_READER v45", () => {
  it("was the active reader; v44 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(46);
    expect(TURN_READER_V44.status).toBe("DEPRECATED");
  });

  it("names the fit question and the pressing turn, keeping v44's rules", () => {
    expect(TURN_READER_V45.template).toContain(V45_FIT);
    expect(TURN_READER_V45.template).toContain(V45_STILL_WAITING);
    expect(TURN_READER_V45.template).toContain("REAL_WORLD_EXAMPLE");
    expect(TURN_READER_V45.template).toContain("HEARD AS:");
    expect(TURN_READER_V45.template.indexOf("- FIT:")).toBeLessThan(
      TURN_READER_V45.template.indexOf("- REAL_WORLD_EXAMPLE:"),
    );
  });

  it("carries FIT and its count; count is null when absent", () => {
    const fit = TurnReaderV45ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "FIT",
        text: "give me three good examples of companies I can invest in",
        count: 3,
      },
    });
    expect(fit.question?.kind).toBe("FIT");
    expect(fit.question?.count).toBe(3);
    const plain = TurnReaderV45ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "FIT", text: "best companies for me" },
    });
    expect(plain.question?.count).toBeNull();
  });

  it("never sends a fit question to the public web, even about a named company", () => {
    const fit = TurnReaderV45ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "FIT", text: "which ones could I actually invest in" },
    });
    for (const aboutNamedOther of [false, true]) {
      expect(
        researchDirectiveFor(
          INITIAL_CONVERSATION_STATE,
          readingFromTurnReader(fit),
          { available: true, aboutNamedOther },
        ),
      ).toEqual({ mode: "NEVER", announceSourceChange: false });
    }
  });
});
