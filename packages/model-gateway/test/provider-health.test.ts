import { describe, expect, it } from "vitest";

import { createProcessLocalProviderHealth } from "../src/index.js";

/**
 * When a provider is taken out of rotation, and when it is not
 * (QX-004 core gate §3, §4).
 *
 * The breaker exists so that traffic stops going to a provider that
 * cannot serve it. What it must never do is take a working provider out
 * because of something on our side — which is exactly what happened
 * hosted on 2026-09-22.
 *
 * A spoken interview turn is given a short model budget so the turn can
 * finish inside the voice route's own deadline. Gemini answers that turn
 * in about a second almost always and in sixteen occasionally. Three of
 * the slow ones inside a minute read as three availability failures, the
 * breaker opened, and a provider that was working perfectly well was
 * skipped for every task class — while the only other provider was
 * rate-limited. The interview had no eligible route at all and the
 * conversation ended.
 *
 * So a timeout counts only when the caller waited long enough for it to
 * be the provider's news rather than its own.
 */

const GOOGLE = "google";
const LITE = "gemini-3.5-flash-lite";
const FLASH = "gemini-3.8-flash";
const at = (ms: number) => new Date(ms);

describe("provider health", () => {
  it("opens after three real availability failures and closes again", () => {
    const health = createProcessLocalProviderHealth();
    for (const t of [0, 100, 200]) {
      health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(t));
    }
    expect(health.state(GOOGLE, LITE, at(300))).toBe("TEMPORARILY_FAILING");
    // Thirty seconds later it is offered again: the breaker is a pause,
    // not a verdict.
    expect(health.state(GOOGLE, LITE, at(31_000))).toBe("HEALTHY");
  });

  it("does not punish a provider for our own short budget", () => {
    const health = createProcessLocalProviderHealth();
    // Three turns whose twelve-second budget expired. That says our
    // budget is shorter than this model's tail; it says nothing about
    // whether the provider is well.
    for (const t of [0, 100, 200]) {
      health.recordFailure(GOOGLE, LITE, "TIMEOUT", at(t), 12_000);
    }
    expect(health.state(GOOGLE, LITE, at(300))).toBe("HEALTHY");
  });

  it("still opens for a timeout somebody actually waited out", () => {
    const health = createProcessLocalProviderHealth();
    for (const t of [0, 100, 200]) {
      health.recordFailure(GOOGLE, LITE, "TIMEOUT", at(t), 45_000);
    }
    expect(health.state(GOOGLE, LITE, at(300))).toBe("TEMPORARILY_FAILING");
  });

  it("opens for a rate limit, which is the provider's own answer", () => {
    const health = createProcessLocalProviderHealth();
    for (const t of [0, 100, 200]) {
      health.recordFailure(GOOGLE, LITE, "RATE_LIMIT", at(t), 40);
    }
    expect(health.state(GOOGLE, LITE, at(300))).toBe("TEMPORARILY_FAILING");
  });

  it("ignores a cancellation entirely: the caller hung up", () => {
    const health = createProcessLocalProviderHealth();
    for (const t of [0, 100, 200, 300, 400]) {
      health.recordFailure(GOOGLE, LITE, "CANCELLED", at(t), 20_000);
    }
    expect(health.state(GOOGLE, LITE, at(500))).toBe("HEALTHY");
  });

  it("forgets the failures as soon as one call works", () => {
    const health = createProcessLocalProviderHealth();
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(0));
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(100));
    health.recordSuccess(GOOGLE, LITE, at(200));
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(300));
    expect(health.state(GOOGLE, LITE, at(400))).toBe("HEALTHY");
  });

  it("takes out one overloaded model, not the account it sits on", () => {
    // Hosted, 2026-09-22. gemini-3.5-flash-lite answered 503 three times,
    // the whole of `google` was skipped, and gemini-3.8-flash — eligible,
    // and quite possibly well — went with it. Every other provider was
    // rate-limited, so the interview had no route at all.
    const health = createProcessLocalProviderHealth();
    for (const t of [0, 100, 200]) {
      health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(t));
    }
    expect(health.state(GOOGLE, LITE, at(300))).toBe("TEMPORARILY_FAILING");
    expect(health.state(GOOGLE, FLASH, at(300))).toBe("HEALTHY");
  });

  it("does not let one model's success clear another model's failures", () => {
    const health = createProcessLocalProviderHealth();
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(0));
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(100));
    health.recordSuccess(GOOGLE, FLASH, at(150));
    health.recordFailure(GOOGLE, LITE, "PROVIDER_OUTAGE", at(200));
    expect(health.state(GOOGLE, LITE, at(300))).toBe("TEMPORARILY_FAILING");
  });
});
