import { describe, expect, it } from "vitest";

import { createStageClock } from "../src/q/stage-clock.js";

/** Step 11: per-stage timing, summed per stage, with an injected clock. */
describe("the stage clock", () => {
  it("sums each stage's time and counts its runs", () => {
    let now = 0;
    const clock = createStageClock(() => now);
    const tick = (ms: number) => () => {
      now += ms;
      return ms;
    };
    expect(clock.time("claimCheck", tick(1.25))).toBe(1.25);
    clock.time("claimCheck", tick(2));
    clock.time("promiseCheck", tick(0.333));
    expect(clock.snapshot()).toEqual({
      claimCheck: { ms: 3.25, runs: 2 },
      promiseCheck: { ms: 0.33, runs: 1 },
    });
  });

  it("counts a stage that threw, and rethrows", () => {
    let now = 0;
    const clock = createStageClock(() => now);
    expect(() =>
      clock.time("claimCheck", () => {
        now += 4;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(clock.snapshot()).toEqual({ claimCheck: { ms: 4, runs: 1 } });
  });
});
