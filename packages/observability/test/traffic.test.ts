import { describe, expect, it } from "vitest";

import { createTrafficCounter } from "../src/index.js";

/** W1-B: requests and server errors over a rolling window, counts only. */
describe("traffic counter", () => {
  it("counts requests and 5xx answers in the window", () => {
    const clock = { value: Date.parse("2026-11-21T09:00:00.000Z") };
    const traffic = createTrafficCounter({ now: () => clock.value });
    expect(traffic.read()).toEqual({
      windowMinutes: 15,
      requests: 0,
      serverErrors: 0,
    });
    for (const status of [200, 201, 404, 429, 500, 503]) traffic.record(status);
    expect(traffic.read()).toEqual({
      windowMinutes: 15,
      requests: 6,
      serverErrors: 2,
    });
  });

  it("forgets minutes that leave the window", () => {
    const clock = { value: Date.parse("2026-11-21T09:00:00.000Z") };
    const traffic = createTrafficCounter({ now: () => clock.value });
    traffic.record(500);
    clock.value += 10 * 60_000;
    traffic.record(200);
    expect(traffic.read().requests).toBe(2);
    clock.value += 5 * 60_000;
    // The 09:00 minute is now 15 minutes old: out of the window.
    expect(traffic.read()).toEqual({
      windowMinutes: 15,
      requests: 1,
      serverErrors: 0,
    });
    clock.value += 60 * 60_000;
    expect(traffic.read().requests).toBe(0);
  });
});
