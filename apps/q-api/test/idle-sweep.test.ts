import { describe, expect, it } from "vitest";

import {
  createIdleSweepSchedule,
  KNOWLEDGE_RECONCILE_SCHEDULE,
  startIdleSweep,
} from "../src/composition/idle-sweep.js";

const MIN = 60 * 1000;

describe("idle sweep schedule (cost pass 2026-11-20)", () => {
  it("keeps the base interval until three runs in a row find nothing", () => {
    const schedule = createIdleSweepSchedule(KNOWLEDGE_RECONCILE_SCHEDULE);
    expect(schedule.after({ found: 0 })).toBe(10 * MIN);
    expect(schedule.after({ found: 0 })).toBe(10 * MIN);
    expect(schedule.after({ found: 0 })).toBe(20 * MIN);
    expect(schedule.after({ found: 0 })).toBe(40 * MIN);
    expect(schedule.after({ found: 0 })).toBe(60 * MIN);
  });

  it("never waits longer than the stated bound, however long it is idle", () => {
    const schedule = createIdleSweepSchedule(KNOWLEDGE_RECONCILE_SCHEDULE);
    let longest = 0;
    for (let run = 0; run < 10_000; run += 1) {
      longest = Math.max(longest, schedule.after({ found: 0 }));
    }
    expect(longest).toBe(60 * MIN);
  });

  it("drops back to the base interval the moment a run finds work", () => {
    const schedule = createIdleSweepSchedule(KNOWLEDGE_RECONCILE_SCHEDULE);
    for (let run = 0; run < 6; run += 1) schedule.after({ found: 0 });
    expect(schedule.after({ found: 2 })).toBe(10 * MIN);
    // And the idle count starts again from nothing.
    expect(schedule.after({ found: 0 })).toBe(10 * MIN);
    expect(schedule.after({ found: 0 })).toBe(10 * MIN);
    expect(schedule.after({ found: 0 })).toBe(20 * MIN);
  });

  it("treats a failed run as not idle: it retries at the base interval", () => {
    const schedule = createIdleSweepSchedule(KNOWLEDGE_RECONCILE_SCHEDULE);
    for (let run = 0; run < 6; run += 1) schedule.after({ found: 0 });
    expect(schedule.after("FAILED")).toBe(10 * MIN);
  });

  it("runs, waits what the schedule says, keeps going after an error, and stops", async () => {
    const waits: number[] = [];
    let fire: (() => void) | null = null;
    const results: (number | Error)[] = [0, new Error("db down"), 3];
    const errors: unknown[] = [];
    let runs = 0;
    const sweep = startIdleSweep({
      run: () => {
        runs += 1;
        const next = results.shift() ?? 0;
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next);
      },
      schedule: createIdleSweepSchedule({
        baseMs: 100,
        maxMs: 400,
        idleRunsBeforeBackoff: 1,
      }),
      firstDelayMs: 50,
      onError: (error) => errors.push(error),
      setTimer: (run, ms) => {
        waits.push(ms);
        fire = run;
        return { clear: () => (fire = null) };
      },
    });
    const step = async () => {
      const current = fire;
      expect(current).not.toBeNull();
      current?.();
      await new Promise((resolve) => setImmediate(resolve));
    };
    await step(); // found 0 → backs off at once (threshold 1)
    await step(); // failed → base
    await step(); // found 3 → base
    expect(runs).toBe(3);
    expect(errors).toHaveLength(1);
    expect(waits).toEqual([50, 200, 100, 100]);
    sweep.stop();
    expect(fire).toBeNull();
  });
});
