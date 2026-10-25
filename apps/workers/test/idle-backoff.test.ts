import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDocumentJobTicker } from "../src/documents/document-jobs.js";
import {
  createIdleBackoff,
  createWakeSignal,
  IDLE_BACKOFF_MAX_MS,
} from "../src/idle-backoff.js";
import type { RunnerLogger } from "../src/outbox-runner.js";
import { createOutboxPublisherRunner } from "../src/outbox-runner.js";
import type { QueueClient } from "../src/queue/pgmq.js";
import { createQueueRunner } from "../src/queue/runner.js";

/**
 * Supabase egress restriction (24 Oct 2026): idle loops back off 2 s → 30 s
 * and come straight back when work is announced or done.
 */

const quiet: RunnerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets the loop under test reach its next wait. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the idle backoff", () => {
  it("doubles each empty wait up to the ceiling, and resets on work", () => {
    const backoff = createIdleBackoff({ minMs: 2_000 });
    const signal = new AbortController().signal;
    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      waits.push(backoff.nextWaitMs());
      void backoff.idle(signal);
    }
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(IDLE_BACKOFF_MAX_MS).toBe(30_000);
    backoff.worked();
    expect(backoff.nextWaitMs()).toBe(2_000);
  });

  it("waits the full time when nothing wakes it", async () => {
    const backoff = createIdleBackoff({ minMs: 2_000 });
    void backoff.idle(new AbortController().signal);
    void backoff.idle(new AbortController().signal);
    let done = false;
    void backoff.idle(new AbortController().signal).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("ends a backed-off wait at once when woken, and starts again from the interval", async () => {
    const wake = createWakeSignal();
    const backoff = createIdleBackoff({ minMs: 2_000, wake });
    const signal = new AbortController().signal;
    void backoff.idle(signal); // 2 s
    void backoff.idle(signal); // 4 s
    let done = false;
    void backoff.idle(signal).then(() => {
      done = true;
    }); // 8 s
    await vi.advanceTimersByTimeAsync(1_000);
    wake.wake();
    await settle();
    expect(done).toBe(true);
    expect(backoff.nextWaitMs()).toBe(2_000);
  });

  it("never polls faster than its interval, however often it is woken", async () => {
    const wake = createWakeSignal();
    const backoff = createIdleBackoff({ minMs: 2_000, wake });
    let done = false;
    void backoff.idle(new AbortController().signal).then(() => {
      done = true;
    });
    for (let i = 0; i < 10; i += 1) wake.wake();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("wakes the other loops when it finds work, but not its own next wait", async () => {
    const wake = createWakeSignal();
    const busy = createIdleBackoff({ minMs: 2_000, wake });
    const other = createIdleBackoff({ minMs: 2_000, wake });
    const signal = new AbortController().signal;
    void other.idle(signal);
    let otherWoke = false;
    void other.idle(signal).then(() => {
      otherWoke = true;
    }); // 4 s
    busy.worked();
    await settle();
    expect(otherWoke).toBe(true);
    expect(busy.nextWaitMs()).toBe(2_000);
  });

  it("stops waiting on abort and leaves no listener behind", async () => {
    const wake = createWakeSignal();
    const listeners = vi.spyOn(wake, "subscribe");
    const backoff = createIdleBackoff({ minMs: 2_000, wake });
    const controller = new AbortController();
    let done = false;
    void backoff.idle(controller.signal).then(() => {
      done = true;
    });
    controller.abort();
    await settle();
    expect(done).toBe(true);
    expect(listeners).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the polling loops", () => {
  it("the queue runner backs off while its queue is empty and resets after a message", async () => {
    const controller = new AbortController();
    const reads: number[] = [];
    const script = [0, 0, 0, 1, 0];
    const client = {
      read: () => {
        reads.push(Date.now());
        const n = script.shift();
        if (n === undefined) controller.abort();
        return Promise.resolve(
          n === 1
            ? [
                {
                  msgId: 1,
                  readCount: 1,
                  enqueuedAt: new Date().toISOString(),
                  message: {},
                },
              ]
            : [],
        );
      },
      remove: () => Promise.resolve(),
    } as unknown as QueueClient;
    const backoff = createIdleBackoff({ minMs: 2_000 });
    const runner = createQueueRunner({
      queue: "q",
      client,
      handle: () => Promise.resolve({ kind: "DONE" }),
      batchSize: 1,
      pollIntervalMs: 2_000,
      idle: backoff,
      visibilityTimeoutSeconds: 30,
      maxAttempts: 3,
      backoff: { initialDelaySeconds: 1, maxDelaySeconds: 1, jitter: false },
      logger: quiet,
    });
    const start = Date.now();
    const running = runner.run(controller.signal);
    await vi.advanceTimersByTimeAsync(60_000);
    await running;
    const gaps = reads.map((t) => t - start);
    // Empty at 0, 2, 6; a message at 14 (read again at once); empty after.
    expect(gaps).toEqual([0, 2_000, 6_000, 14_000, 14_000, 16_000]);
  });

  it("the outbox runner backs off while idle", async () => {
    const controller = new AbortController();
    const polls: number[] = [];
    const runner = createOutboxPublisherRunner({
      publisher: {
        publishAvailable: () => {
          polls.push(Date.now());
          if (polls.length === 4) controller.abort();
          return Promise.resolve({
            claimed: 0,
            published: 0,
            failed: 0,
            exhausted: 0,
            records: [],
          });
        },
      },
      batchSize: 10,
      pollIntervalMs: 2_000,
      idle: createIdleBackoff({ minMs: 2_000 }),
      logger: quiet,
    });
    const start = Date.now();
    const running = runner.run(controller.signal);
    await vi.advanceTimersByTimeAsync(60_000);
    await running;
    expect(polls.map((t) => t - start)).toEqual([0, 2_000, 6_000, 14_000]);
  });

  it("an announced document job is taken within a second of a long idle", async () => {
    const controller = new AbortController();
    const wake = createWakeSignal();
    const taken: number[] = [];
    let waiting = false;
    const running = runDocumentJobTicker({
      runner: {
        runOnce: () => {
          if (!waiting) return Promise.resolve(false);
          waiting = false;
          taken.push(Date.now());
          controller.abort();
          return Promise.resolve(true);
        },
      },
      signal: controller.signal,
      logger: quiet,
      idle: createIdleBackoff({ minMs: 3_000, wake }),
    });
    // Idle long enough to reach the ceiling.
    await vi.advanceTimersByTimeAsync(120_000);
    const uploadAt = Date.now();
    waiting = true;
    wake.wake(); // the database's NOTIFY on the job's commit
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    expect(taken).toHaveLength(1);
    expect((taken[0] ?? Infinity) - uploadAt).toBeLessThan(1_000);
  });
});
