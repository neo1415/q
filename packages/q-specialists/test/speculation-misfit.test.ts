import { describe, expect, it } from "vitest";

import {
  readingMisfit,
  SPECULATIVE_ANSWER_KIND,
  SPECULATIVE_READING,
} from "../src/speculation.js";

/**
 * QA QO-32 (2026-10-23, voice): "Prep me for a call with Zino" was answered
 * first by the speculative analyst answer ("I'll play Zino Aviation" over
 * an older list) while the prep itself was written; the prep then landed
 * after the next turn. A reading answered by its own branch cancels the
 * speculation as soon as it lands.
 */
describe("readings the speculation cannot be", () => {
  it("a call to prepare is acted on, never speculated", () => {
    expect(
      readingMisfit({
        ...SPECULATIVE_READING,
        meetingPrep: { counterpart: "Zino Aviation" },
      }),
    ).toBe("ACTED");
  });

  it("a team job is acted on, never speculated", () => {
    expect(readingMisfit({ ...SPECULATIVE_READING, teamJob: true })).toBe(
      "ACTED",
    );
  });

  it("a plain question with neither is still the speculation's own", () => {
    expect(
      readingMisfit({
        ...SPECULATIVE_READING,
        answerKind: SPECULATIVE_ANSWER_KIND,
        teamJob: false,
        meetingPrep: null,
      }),
    ).toBeNull();
  });

  // Reader latency (2026-11-06): v77-v78 readings the speculation, begun
  // before the reading, cannot be -- cancelled as soon as the reading lands.
  it("words bound to the conversation's records are never speculated", () => {
    expect(
      readingMisfit({
        ...SPECULATIVE_READING,
        answerKind: SPECULATIVE_ANSWER_KIND,
        references: [
          { phrase: "her company", entityIds: ["E2"], confidence: "HIGH" },
        ],
      }),
    ).toBe("BOUND");
  });

  it("heavier work, or none read, is another answer", () => {
    for (const answerKind of ["ANALYSIS", "COMPARISON", "DOCUMENT", null]) {
      expect(readingMisfit({ ...SPECULATIVE_READING, answerKind })).toBe(
        "NOTE",
      );
    }
  });

  it("a compound ask is another answer", () => {
    expect(
      readingMisfit({
        ...SPECULATIVE_READING,
        answerKind: SPECULATIVE_ANSWER_KIND,
        parts: [
          { ask: "What's Silo Credit's ARR?", kind: "LOOKUP" },
          { ask: "Who is Silo Credit's CEO?", kind: "LOOKUP" },
        ],
      }),
    ).toBe("NOTE");
  });
});
