import { describe, expect, it } from "vitest";

import { ResearchProviderFailure } from "../src/ports.js";
import type { PublicWebResearchProvider } from "../src/ports.js";
import {
  BREAKER_COOL_OFF_MS,
  isResting,
  withCircuitBreaker,
  type BreakerTrip,
} from "../src/providers/breaker.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";

/**
 * Production 2026-10-25: Tavily 432, Serper and Brave 402, ScrapingBee 401
 * -- every key refused or spent, each still asked ~12 times a turn. A
 * refused or spent key costs nothing after its first refusal, for a
 * cool-off window, and is logged once.
 */

function refusing(code: string, status: number, failureClass = "RATE_LIMIT") {
  let calls = 0;
  const provider: PublicWebResearchProvider = {
    code: code as PublicWebResearchProvider["code"],
    search: () => {
      calls += 1;
      return Promise.reject(
        new ResearchProviderFailure({
          providerCode: code as PublicWebResearchProvider["code"],
          failureClass: failureClass as ResearchProviderFailure["failureClass"],
          status,
        }),
      );
    },
    extract: () => Promise.reject(new Error("not used")),
  };
  return { provider, calls: () => calls };
}

const request = {
  query: "paystack founder",
  maxResults: 6,
  freshness: "ANY" as const,
  includeDomains: [],
};

describe("a refused or spent key rests, for the whole process", () => {
  it.each([
    ["tavily", 432, "RATE_LIMIT"],
    ["serper", 402, "UNAVAILABLE"],
    ["brave", 402, "UNAVAILABLE"],
    ["scrapingbee", 401, "AUTHENTICATION"],
  ])(
    "%s %d: asked once, then not again until the cool-off ends",
    async (code, status, failureClass) => {
      let clock = 1_000;
      const trips: BreakerTrip[] = [];
      const inner = refusing(code, status, failureClass);
      const guarded = withCircuitBreaker(inner.provider, {
        now: () => clock,
        onTrip: (trip) => trips.push(trip),
      });
      for (let turn = 0; turn < 12; turn += 1) {
        await expect(guarded.search(request, {})).rejects.toBeInstanceOf(
          ResearchProviderFailure,
        );
      }
      expect(inner.calls()).toBe(1);
      expect(trips).toEqual([
        expect.objectContaining({
          provider: code,
          status,
          coolOffMs: BREAKER_COOL_OFF_MS.SPENT,
        }),
      ]);
      clock += BREAKER_COOL_OFF_MS.SPENT;
      await expect(guarded.search(request, {})).rejects.toBeDefined();
      expect(inner.calls()).toBe(2);
    },
  );

  it("a rate limit rests a minute; a timeout does not trip it", async () => {
    let clock = 0;
    const limited = refusing("serper", 429);
    const guarded = withCircuitBreaker(limited.provider, { now: () => clock });
    await expect(guarded.search(request, {})).rejects.toBeDefined();
    await expect(guarded.search(request, {})).rejects.toBeDefined();
    expect(limited.calls()).toBe(1);
    clock += BREAKER_COOL_OFF_MS.RATE_LIMIT;
    await expect(guarded.search(request, {})).rejects.toBeDefined();
    expect(limited.calls()).toBe(2);

    const slow = refusing("tavily", 504, "TIMEOUT");
    const timed = withCircuitBreaker(slow.provider, { now: () => clock });
    await expect(timed.search(request, {})).rejects.toBeDefined();
    await expect(timed.search(request, {})).rejects.toBeDefined();
    expect(slow.calls()).toBe(2);
  });

  it("calls in flight together trip it once", async () => {
    const trips: BreakerTrip[] = [];
    const inner = refusing("brave", 402, "UNAVAILABLE");
    const guarded = withCircuitBreaker(inner.provider, {
      onTrip: (trip) => trips.push(trip),
    });
    await Promise.allSettled([
      guarded.search(request, {}),
      guarded.search(request, {}),
      guarded.search(request, {}),
    ]);
    expect(trips).toHaveLength(1);
  });

  it("with every index resting, a merged search fails at once, asks no one, and logs nothing per call", async () => {
    const dead = [
      refusing("tavily", 432),
      refusing("serper", 402, "UNAVAILABLE"),
      refusing("brave", 402, "UNAVAILABLE"),
      refusing("scrapingbee", 401, "AUTHENTICATION"),
    ];
    const logged: string[] = [];
    const merged = createFallbackResearchProvider({
      providers: dead.map((one) => withCircuitBreaker(one.provider)),
      parallelSearch: true,
      observe: (call) => logged.push(`${call.provider}:${call.outcome}`),
    });
    // The first turn finds every key refused.
    await expect(merged.search(request, {})).rejects.toBeDefined();
    const firstTurn = logged.length;
    expect(firstTurn).toBe(4);
    // The next eleven searches cost nothing and log nothing.
    for (let turn = 0; turn < 11; turn += 1) {
      const failure = await merged
        .search(request, {})
        .catch((error: unknown) => error);
      expect(isResting(failure)).toBe(true);
    }
    expect(dead.map((one) => one.calls())).toEqual([1, 1, 1, 1]);
    expect(logged).toHaveLength(firstTurn);
  });
});
