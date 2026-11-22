import { afterEach, describe, expect, it, vi } from "vitest";

import { checkDatabaseReadiness } from "../src/health.js";
import type { DatabaseExecutor } from "../src/types.js";

// W4-F (audit finding 9): the tests that measure time run it fake, so no
// assertion depends on how fast the machine is (each turns it on itself).
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Run fake time forward in small steps until `work` settles, so a
 * deadline or a slow stub plays out exactly, however busy the machine.
 */
async function settled<T>(work: Promise<T>, stepMs = 5): Promise<T> {
  let done = false;
  // Watched, not consumed: a rejection still reaches the caller.
  void work.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let at = 0; !done && at < 120_000; at += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return work;
}

/** An executor whose every query resolves or hangs as told. */
function executor(answer: "ok" | "hang" | "fail"): DatabaseExecutor {
  const query = () =>
    answer === "ok"
      ? Promise.resolve([{ "?column?": 1 }])
      : answer === "fail"
        ? Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432"))
        : new Promise(() => undefined);
  return query as unknown as DatabaseExecutor;
}

describe("checkDatabaseReadiness (DEF-A4)", () => {
  it("is reachable when the database answers", async () => {
    await expect(checkDatabaseReadiness(executor("ok"), 50)).resolves.toEqual({
      reachable: true,
    });
  });

  it("is unreachable with TIMEOUT when the database never answers", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    await expect(
      settled(checkDatabaseReadiness(executor("hang"), 50)),
    ).resolves.toEqual({ reachable: false, failure: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("names a failure kind, never the host", async () => {
    const health = await checkDatabaseReadiness(executor("fail"), 50);
    expect(health.reachable).toBe(false);
    expect(JSON.stringify(health)).not.toContain("10.0.0.1");
  });
});
