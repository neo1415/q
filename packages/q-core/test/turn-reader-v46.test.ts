import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  INITIAL_CONVERSATION_STATE,
  readingFromTurnReader,
  researchDirectiveFor,
  TURN_READER_V45,
  TURN_READER_V46,
  TurnReaderV46ResultSchema,
  V46_DISCOVER,
  V46_DISCOVER_FIELDS,
} from "../src/index.js";

/**
 * TURN_READER v46 (founder brief K1, live 2026-10-09 15:57): companies of
 * a kind are DISCOVER_COMPANIES with their structure, never researched.
 */
describe("TURN_READER v46", () => {
  it("was the active reader; v45 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(47);
    expect(TURN_READER_V45.status).toBe("DEPRECATED");
  });

  it("names the kind and its fields, keeping v45's rules", () => {
    const template = TURN_READER_V46.template;
    expect(template).toContain(V46_DISCOVER);
    expect(template).toContain(V46_DISCOVER_FIELDS);
    expect(template).toContain("- FIT:");
    expect(template).toContain("STILL WAITING:");
    expect(template.indexOf("- DISCOVER_COMPANIES:")).toBeLessThan(
      template.indexOf("- FIT:"),
    );
  });

  it("carries the request's structure, with defaults when parts are absent", () => {
    const read = TurnReaderV46ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "DISCOVER_COMPANIES",
        text: "three fintech companies in Nigeria",
        count: 3,
        discover: { sectors: ["fintech"], countries: ["NG"] },
      },
    });
    expect(read.question?.discover).toEqual({
      sectors: ["fintech"],
      countries: ["NG"],
      stages: [],
      ranking: "NONE",
      mandateRelevant: false,
      previous: false,
    });
    const plain = TurnReaderV46ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "ADVICE", text: "what should I do?" },
    });
    expect(plain.question?.discover).toBeNull();
  });

  it("never sends companies of a kind to the public web", () => {
    const read = TurnReaderV46ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "DISCOVER_COMPANIES",
        text: "find five healthtech startups",
        discover: { sectors: ["digital_health"] },
      },
    });
    expect(
      researchDirectiveFor(
        INITIAL_CONVERSATION_STATE,
        readingFromTurnReader(read),
        { available: true, aboutNamedOther: false },
      ),
    ).toEqual({ mode: "NEVER", announceSourceChange: false });
  });
});
