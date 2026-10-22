import { describe, expect, it } from "vitest";

import { createProcessLocalProviderHealth } from "../src/index.js";
import { geminiAccountExhausted } from "../src/providers/google.js";
import { accountExhausted, refusalClass } from "../src/providers/openai.js";

/**
 * A provider account that cannot serve (live 2026-10-01: OpenAI answered
 * "credit_balance_exhausted"). It was classed TRANSIENT, so every turn
 * retried it twice before falling back and runs failed after 50 to 95 s.
 * Now it is PERMANENT for the attempt (no same-model retry; another
 * candidate may answer) and the provider is skipped, every model on it,
 * until a probe ten minutes later.
 */

describe("an exhausted provider account", () => {
  it("is PERMANENT and flagged, not a transient blip, from the vendor code or a 402", () => {
    // Live: a streamed refusal carried the code and no status.
    expect(refusalClass(undefined, "credit_balance_exhausted")).toEqual({
      failureClass: "PERMANENT",
      accountExhausted: true,
    });
    expect(refusalClass(429, "insufficient_quota").accountExhausted).toBe(true);
    expect(accountExhausted(402, undefined)).toBe(true);
    expect(refusalClass(429, "rate_limit_exceeded")).toEqual({
      failureClass: "RATE_LIMIT",
      accountExhausted: false,
    });
    expect(refusalClass(undefined, undefined).failureClass).toBe("TRANSIENT");
  });

  it("takes every model on the provider out at once, and probes it again later", () => {
    const health = createProcessLocalProviderHealth();
    const at = (ms: number) => new Date(ms);
    health.recordFailure(
      "openai",
      "gpt-5.6-luna",
      "PERMANENT",
      at(0),
      300,
      true,
    );
    expect(health.state("openai", "gpt-5.6-luna", at(1))).toBe(
      "TEMPORARILY_FAILING",
    );
    expect(health.state("openai", "gpt-5.6-mini", at(1))).toBe(
      "TEMPORARILY_FAILING",
    );
    expect(health.state("google", "gemini-3.5-flash-lite", at(1))).toBe(
      "HEALTHY",
    );
    expect(health.state("openai", "gpt-5.6-luna", at(10 * 60_000 + 1))).toBe(
      "HEALTHY",
    );
    // A one-off PERMANENT that is not the account's says nothing about it.
    health.recordFailure("google", "gemini-3.5-flash", "PERMANENT", at(0));
    expect(health.state("google", "gemini-3.5-flash", at(1))).toBe("HEALTHY");
  });
});

/**
 * Round 8 (hosted 2026-10-21: both Gemini keys answered 402 Payment
 * Required on every call, so every turn paid a failed first attempt).
 */
describe("Gemini's exhausted account, and the turns after it", () => {
  it("reads a 402, or a 429 whose quota itself is spent, as the account", () => {
    expect(geminiAccountExhausted(402, "Payment Required")).toBe(true);
    expect(
      geminiAccountExhausted(
        429,
        "You exceeded your current quota, please check your plan and billing details.",
      ),
    ).toBe(true);
    expect(
      geminiAccountExhausted(
        429,
        "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel",
      ),
    ).toBe(true);
    // A per-minute rate is a rate, not the account.
    expect(
      geminiAccountExhausted(
        429,
        "Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel",
      ),
    ).toBe(false);
    expect(geminiAccountExhausted(500, "internal")).toBe(false);
  });

  it("a refused key sets that model aside, not its siblings", () => {
    const health = createProcessLocalProviderHealth();
    health.recordFailure(
      "google",
      "gemini-image",
      "AUTHENTICATION",
      new Date(0),
    );
    expect(health.state("google", "gemini-image", new Date(1))).toBe(
      "TEMPORARILY_FAILING",
    );
    expect(health.state("google", "gemini-3.5-flash", new Date(1))).toBe(
      "HEALTHY",
    );
    expect(
      health.state("google", "gemini-image", new Date(10 * 60_000 + 1)),
    ).toBe("HEALTHY");
  });

  it("a 429 backs that model off at once, for its Retry-After, bounded", () => {
    const health = createProcessLocalProviderHealth();
    health.recordFailure(
      "google",
      "gemini-3.5-flash-lite",
      "RATE_LIMIT",
      new Date(0),
      200,
      false,
      5_000,
    );
    expect(health.state("google", "gemini-3.5-flash-lite", new Date(1))).toBe(
      "BACKING_OFF",
    );
    expect(
      health.state("google", "gemini-3.5-flash-lite", new Date(5_001)),
    ).toBe("HEALTHY");
    health.recordFailure(
      "google",
      "gemini-3.5-flash-lite",
      "RATE_LIMIT",
      new Date(10_000),
      200,
      false,
      10 * 60_000,
    );
    // Bounded: never longer than a minute.
    expect(
      health.state("google", "gemini-3.5-flash-lite", new Date(70_001)),
    ).toBe("HEALTHY");
  });
});
