import { describe, expect, it } from "vitest";

import { readingMisfit, SPECULATIVE_READING } from "../src/speculation.js";

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
        teamJob: false,
        meetingPrep: null,
      }),
    ).toBeNull();
  });
});
