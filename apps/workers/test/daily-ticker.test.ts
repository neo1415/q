import { describe, expect, it } from "vitest";

import {
  DAILY_TICK_INTERVAL_MS,
  runDailyTicker,
} from "../src/daily/composition.js";

/** DAILY: The Q Daily's ticker runs every minute and survives a failed tick. */

describe("The Q Daily ticker", () => {
  it("ticks every minute and keeps going after a failure", async () => {
    const controller = new AbortController();
    const logged: string[] = [];
    let ticks = 0;
    const waits: number[] = [];
    await runDailyTicker({
      daily: {
        tick: () => {
          ticks += 1;
          return ticks === 1
            ? Promise.reject(new Error("db blip"))
            : Promise.resolve({
                defaults: 0,
                prepared: 1,
                emailed: 1,
                skipped: 0,
              });
        },
      },
      signal: controller.signal,
      logger: {
        info: (_fields, message) => logged.push(message),
        warn: (_fields, message) => logged.push(message),
        error: (_fields, message) => logged.push(message),
      },
      now: () => new Date("2026-10-05T06:00:00Z"),
      sleep: (ms) => {
        waits.push(ms);
        if (waits.length === 2) controller.abort();
        return Promise.resolve();
      },
    });
    expect(ticks).toBe(2);
    expect(waits).toEqual([DAILY_TICK_INTERVAL_MS, DAILY_TICK_INTERVAL_MS]);
    expect(logged).toEqual([
      "q daily tick failed; retrying next interval",
      "q daily tick",
    ]);
  });
});
