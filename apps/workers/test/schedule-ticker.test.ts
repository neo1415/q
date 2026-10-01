import { describe, expect, it } from "vitest";

import {
  runScheduleTicker,
  SCHEDULE_TICK_INTERVAL_MS,
} from "../src/integrations/schedule-ticker.js";

/**
 * BIZ-008: the reminder/brief ticker runs every 30 seconds (a T-15 email
 * lands within a minute) and keeps ticking through a failed tick.
 */

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("schedule ticker", () => {
  it("delivers and briefs every 30 seconds, surviving a failure", async () => {
    const controller = new AbortController();
    let ticks = 0;
    let mails = 0;
    const waits: number[] = [];
    await runScheduleTicker({
      schedule: {
        deliverDue: () => {
          ticks += 1;
          return ticks === 1
            ? Promise.reject(new Error("db blip"))
            : Promise.resolve({ delivered: 1, emailed: 1 });
        },
        prepareBriefs: () => Promise.resolve(0),
        refreshMeetLinks: () => Promise.resolve({ found: 0, waiting: 0 }),
      },
      meetingMail: {
        tick: () => {
          mails += 1;
          return Promise.resolve({ sent: 0 });
        },
      },
      signal: controller.signal,
      logger,
      sleep: (ms) => {
        waits.push(ms);
        if (waits.length === 3) controller.abort();
        return Promise.resolve();
      },
    });
    expect(ticks).toBe(3);
    // The meeting email runs on every tick that got past the first step.
    expect(mails).toBe(2);
    expect(waits).toEqual([
      SCHEDULE_TICK_INTERVAL_MS,
      SCHEDULE_TICK_INTERVAL_MS,
      SCHEDULE_TICK_INTERVAL_MS,
    ]);
    expect(SCHEDULE_TICK_INTERVAL_MS).toBe(30_000);
  });
});
