import { describe, expect, it } from "vitest";

import { inBatches } from "../src/application/relationship-status.js";

/**
 * L1 latency sweep (2026-10-06): a relationship list read three queries
 * per relationship, one relationship after another (hosted GET
 * /v1/network/relationships p50 727 ms). Here each read takes 50 ms.
 */
describe("a relationship list's reads", () => {
  it("before: 16 rows one after another took >= 800 ms; after: 8 at a time, ~100 ms, in list order", async () => {
    let inFlight = 0;
    let most = 0;
    const read = (n: number) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise<number>((resolve) =>
        setTimeout(
          () => {
            inFlight -= 1;
            resolve(n * 10);
          },
          // Later rows answer sooner: order must still be the list's.
          50 - n,
        ),
      );
    };
    const rows = Array.from({ length: 16 }, (_, index) => index);
    const started = Date.now();
    const out = await inBatches(rows, read);
    const took = Date.now() - started;
    expect(out).toEqual(rows.map((n) => n * 10));
    expect(most).toBe(8);
    expect(took).toBeLessThan(16 * 50);
    expect(took).toBeLessThan(300);
  });

  it("never holds more reads open than its bound", async () => {
    let inFlight = 0;
    let most = 0;
    await inBatches(
      Array.from({ length: 10 }, (_, index) => index),
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
      },
      3,
    );
    expect(most).toBe(3);
  });
});
