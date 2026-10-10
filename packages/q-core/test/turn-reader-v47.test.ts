import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V46,
  TURN_READER_V47,
  TurnReaderV47ResultSchema,
  V47_SUBJECT,
} from "../src/index.js";

/** TURN_READER v47 (K8): the reader names a prepared subject. */
describe("TURN_READER v47", () => {
  it("was the active reader; v46 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(48);
    expect(TURN_READER_V46.status).toBe("DEPRECATED");
  });

  it("adds the subject rule and keeps v46's", () => {
    expect(TURN_READER_V47.template).toContain(V47_SUBJECT);
    expect(TURN_READER_V47.template).toContain("- DISCOVER_COMPANIES:");
  });

  it("carries the subject, null by default", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(
      TurnReaderV47ResultSchema.parse({
        ...base,
        question: {
          kind: "THEIR_OWN_RECORDS",
          text: "what is my mandate",
          subject: "MANDATE",
        },
      }).question?.subject,
    ).toBe("MANDATE");
    expect(
      TurnReaderV47ResultSchema.parse({
        ...base,
        question: { kind: "ADVICE", text: "what should I do" },
      }).question?.subject,
    ).toBeNull();
  });
});
