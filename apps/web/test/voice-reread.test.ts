import { describe, expect, it } from "vitest";

import { recordSettled } from "../src/features/q/use-q-conversation";
import {
  rereadUntilSettled,
  VOICE_REREAD_MAX,
} from "../src/features/q/voice-reread";

/**
 * P10: a spoken answer's cards reach the screen only from the record, so
 * the record is read until it holds the run as finished -- not twice on a
 * clock that a ranked top five outlasts.
 */
function harness(answers: readonly boolean[]) {
  const timers: (() => void)[] = [];
  let reads = 0;
  const stop = rereadUntilSettled({
    read: () => {
      const settled = answers[reads] ?? false;
      reads += 1;
      return Promise.resolve(settled);
    },
    schedule: (run) => {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
  });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const tick = async () => {
    const next = timers.shift();
    next?.();
    await flush();
  };
  return { stop, tick, flush, reads: () => reads, waiting: () => timers.length };
}

describe("reading a voice turn's answer back", () => {
  it("keeps reading while the run is still going, and stops once it is stored", async () => {
    const h = harness([false, false, false, true]);
    await h.flush();
    expect(h.reads()).toBe(1);
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.reads()).toBe(4);
    // Settled: nothing more is scheduled.
    expect(h.waiting()).toBe(0);
  });

  it("reads once when the record already holds the finished run", async () => {
    const h = harness([true]);
    await h.flush();
    expect(h.reads()).toBe(1);
    expect(h.waiting()).toBe(0);
  });

  it("stops when a newer turn replaces it, and never reads forever", async () => {
    const h = harness([false, false]);
    await h.flush();
    h.stop();
    expect(h.waiting()).toBe(0);
    const forever = harness([]);
    for (let i = 0; i < VOICE_REREAD_MAX + 5; i += 1) await forever.tick();
    expect(forever.reads()).toBe(VOICE_REREAD_MAX);
  });

  it("counts a record as settled only when its newest run has finished", () => {
    expect(recordSettled(null)).toBe(true);
    expect(recordSettled({ status: "COMPLETED" })).toBe(true);
    expect(recordSettled({ status: "FAILED" })).toBe(true);
    expect(recordSettled({ status: "RUNNING" })).toBe(false);
    expect(recordSettled({ status: "QUEUED" })).toBe(false);
  });
});
