import { describe, expect, it } from "vitest";

import { runViewingDigest } from "../src/analytics/viewing-digest.js";

describe("the weekly viewing digest loop (A6)", () => {
  it("runs the digest each interval, logs what it sent, and survives a failure", async () => {
    const controller = new AbortController();
    const results: (number | Error)[] = [0, new Error("db blip"), 2];
    const logged: string[] = [];
    let runs = 0;
    await runViewingDigest({
      digest: () => {
        const next = results[runs++];
        if (next instanceof Error) return Promise.reject(next);
        if (runs >= results.length) controller.abort();
        return Promise.resolve(next ?? 0);
      },
      intervalMs: 1,
      signal: controller.signal,
      logger: {
        info: (_fields, message) => {
          logged.push(message);
        },
        warn: (_fields, message) => {
          logged.push(message);
        },
        error: (_fields, message) => {
          logged.push(message);
        },
      },
      sleep: () => Promise.resolve(),
    });
    expect(runs).toBe(3);
    expect(logged).toEqual([
      "viewing digest failed; retrying next interval",
      "viewing digest sent",
    ]);
  });
});
