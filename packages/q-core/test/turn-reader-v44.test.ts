import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V43,
  TURN_READER_V44,
  TurnReaderV44ResultSchema,
  V44_UNCLEAR,
} from "../src/index.js";

/**
 * TURN_READER v44 (Zino live 2026-10-08 11:13): garbled voice words are
 * read by sound before UNCLEAR_TRANSCRIPT, and what needs them is a
 * question Q answers, not a screen.
 */
describe("TURN_READER v44", () => {
  it("was the active reader; v43 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(47);
    expect(TURN_READER_V43.status).toBe("DEPRECATED");
  });

  it("reads garbled speech by sound and keeps v43's rules", () => {
    expect(TURN_READER_V44.template).toContain(V44_UNCLEAR);
    expect(TURN_READER_V44.template).toContain("Fidiani inanituma attention");
    expect(TURN_READER_V44.template).toContain("WHAT NEEDS THEM");
    expect(TURN_READER_V44.template.length).toBeGreaterThan(
      TURN_READER_V43.template.length,
    );
  });

  it("carries heardAs, null by default", () => {
    const base = TurnReaderV44ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "MEDIUM",
      transcript: "NOISY",
      question: { kind: "THEIR_OWN_RECORDS", text: "what needs me" },
      heardAs: "find anything that needs my attention",
    });
    expect(base.heardAs).toBe("find anything that needs my attention");
  });
});
