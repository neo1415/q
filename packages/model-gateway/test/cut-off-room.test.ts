import { describe, expect, it } from "vitest";

import { retryRoomAfterCutOff } from "../src/gateway.js";
import type { EligibleCandidate } from "../src/policy/eligibility.js";

/**
 * After an answer is cut off at its ceiling, the next attempt gets twice
 * the room and twice the time, within the model's maximum and the
 * request's money cap (production 2026-10-29: a retry at the model's
 * maximum, at the usual timeout, ran a research plan to its 45 s timeout).
 */
function candidate(
  maxOutputTokens: number,
  outputPerMillion: number,
): EligibleCandidate {
  return {
    candidateIndex: 0,
    estimatedInputTokens: 4_000,
    estimatedAttemptCostUsd: 0,
    model: { maxOutputTokens } as EligibleCandidate["model"],
    provider: {} as EligibleCandidate["provider"],
    price: {
      id: "p",
      inputPerMillion: 0.25,
      cachedInputPerMillion: 0.025,
      outputPerMillion,
    } as unknown as EligibleCandidate["price"],
  };
}

const budget = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.25,
  maxOutputTokens: 4_000,
  attemptTimeoutMs: 45_000,
};

describe("the room after a cut-off", () => {
  it("is twice the allowance, with twice the time", () => {
    expect(retryRoomAfterCutOff(budget, candidate(128_000, 1.2), 0)).toEqual({
      outputTokens: 8_000,
      timeoutMs: 90_000,
    });
  });

  it("never passes the model's own maximum", () => {
    const room = retryRoomAfterCutOff(budget, candidate(6_000, 1.2), 0);
    expect(room.outputTokens).toBe(6_000);
    expect(room.timeoutMs).toBe(Math.round(45_000 * (6_000 / 4_000)));
  });

  it("stays inside what the request's money cap still pays for, never below the allowance", () => {
    // USD 0.01 left at USD 1.20 a million output tokens: about 7,500
    // tokens after the input, so less than twice 4,000.
    const tight = retryRoomAfterCutOff(
      { ...budget, maxEstimatedCostUsd: 0.02 },
      candidate(128_000, 1.2),
      0.01,
    );
    expect(tight.outputTokens).toBeGreaterThan(4_000);
    expect(tight.outputTokens).toBeLessThan(8_000);
    const none = retryRoomAfterCutOff(
      { ...budget, maxEstimatedCostUsd: 0.02 },
      candidate(128_000, 1.2),
      0.0199,
    );
    expect(none.outputTokens).toBe(4_000);
  });
});
