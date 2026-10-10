import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V47,
  TURN_READER_V48,
  TurnReaderV48ResultSchema,
  V48_SUBJECT,
} from "../src/index.js";

/** TURN_READER v48 (K Part 4): their own company is a prepared subject. */
describe("TURN_READER v48", () => {
  it("is the active reader and v47 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(48);
    expect(TURN_READER_V47.status).toBe("DEPRECATED");
  });

  it("names OWN_COMPANY in the subject rule", () => {
    expect(TURN_READER_V48.template).toContain(V48_SUBJECT);
    expect(V48_SUBJECT).toContain("OWN_COMPANY");
  });

  it("carries OWN_COMPANY", () => {
    expect(
      TurnReaderV48ResultSchema.parse({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: {
          kind: "THEIR_OWN_RECORDS",
          text: "what does Capital Q have on my company",
          subject: "OWN_COMPANY",
        },
      }).question?.subject,
    ).toBe("OWN_COMPANY");
  });
});
