import { describe, expect, it } from "vitest";

import {
  createGeneralRateLimiter,
  DEFAULT_GENERAL_RATE_LIMITS,
  RATE_LIMIT_MAX_KEYS,
} from "../src/rate-limit.js";

/** W1-A: the general limiter, on a fixed clock. */
describe("the general rate limiter", () => {
  it("allows the allowance per window, then says when to retry", () => {
    let now = 30_000;
    const limiter = createGeneralRateLimiter(
      { perUser: 2, perAddress: 1, windowMs: 60_000 },
      () => now,
    );
    const person = { userId: "u1", address: "203.0.113.1" };
    expect(limiter.take(person)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.take(person)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.take(person)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    now = 60_000;
    expect(limiter.take(person).allowed).toBe(true);
  });

  it("keeps a person and an address apart, and each person apart", () => {
    const limiter = createGeneralRateLimiter(
      { perUser: 1, perAddress: 1, windowMs: 60_000 },
      () => 0,
    );
    expect(limiter.take({ userId: "u1", address: "a" }).allowed).toBe(true);
    expect(limiter.take({ userId: "u2", address: "a" }).allowed).toBe(true);
    expect(limiter.take({ userId: null, address: "a" }).allowed).toBe(true);
    expect(limiter.take({ userId: "u1", address: "b" }).allowed).toBe(false);
  });

  it("is generous by default and bounded in memory", () => {
    expect(DEFAULT_GENERAL_RATE_LIMITS.perUser).toBeGreaterThanOrEqual(600);
    const limiter = createGeneralRateLimiter(
      { perUser: 1, perAddress: 1, windowMs: 60_000 },
      () => 0,
    );
    for (let i = 0; i <= RATE_LIMIT_MAX_KEYS; i += 1) {
      limiter.take({ userId: `u${String(i)}`, address: "a" });
    }
    // The oldest key was let go, so it starts afresh.
    expect(limiter.take({ userId: "u0", address: "a" }).allowed).toBe(true);
  });
});
