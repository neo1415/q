import { describe, expect, it } from "vitest";

import {
  GEMINI_MIN_DEADLINE_MS,
  geminiDeadlineMs,
} from "../src/providers/google.js";

/**
 * The deadline the adapter sends Gemini (QX-004 core gate §3).
 *
 * Found locally in seconds, after two rounds of blaming a genuine Google
 * outage for it. The spoken interview had been given a short model budget
 * so a turn could finish inside the voice route's own deadline, the
 * adapter passed that budget straight through as Gemini's request
 * deadline, and Gemini answered:
 *
 *   400 INVALID_ARGUMENT — "Manually set deadline 8s is too short.
 *   Minimum allowed deadline is 10s."
 *
 * Every call. Not some. The routing was right, the attestation was right,
 * the model was eligible, and not one request was ever valid.
 *
 * A caller whose budget is shorter than the vendor's minimum is not
 * asking for something invalid. It is asking to stop waiting sooner, and
 * the abort signal is what enforces that — so the number sent to the
 * vendor is floored and the caller's own budget is left alone.
 */
describe("the deadline Gemini is given", () => {
  it("is never below the minimum Gemini accepts", () => {
    expect(geminiDeadlineMs(8_000)).toBe(GEMINI_MIN_DEADLINE_MS);
    expect(geminiDeadlineMs(1)).toBe(GEMINI_MIN_DEADLINE_MS);
    expect(geminiDeadlineMs(0)).toBe(GEMINI_MIN_DEADLINE_MS);
  });

  it("is the caller's own budget whenever that is long enough", () => {
    expect(geminiDeadlineMs(12_000)).toBe(12_000);
    expect(geminiDeadlineMs(45_000)).toBe(45_000);
    expect(geminiDeadlineMs(GEMINI_MIN_DEADLINE_MS)).toBe(
      GEMINI_MIN_DEADLINE_MS,
    );
  });
});
