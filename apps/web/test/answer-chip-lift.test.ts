import { describe, expect, it } from "vitest";

import { liftClear } from "../src/features/q/answer-chip";

/**
 * F-101 (QA 2026-10-24): the answer chip covered the Work page's Approve
 * row at 1440px. It rises just clear of the page's primary actions, and
 * stays put when rising would take it into the top of the screen.
 */
const chip = { left: 956, right: 1416, top: 800, bottom: 876 };

describe("liftClear", () => {
  it("stays where it is when nothing is under it", () => {
    expect(
      liftClear(chip, [{ left: 0, right: 600, top: 800, bottom: 850 }]),
    ).toBe(0);
  });

  it("rises to sit just above an action it would cover", () => {
    const approve = { left: 680, right: 1000, top: 808, bottom: 852 };
    expect(liftClear(chip, [approve])).toBe(876 - 808 + 8);
  });

  it("keeps rising past a second action it meets on the way up", () => {
    const approve = { left: 680, right: 1000, top: 808, bottom: 852 };
    const above = { left: 1000, right: 1200, top: 700, bottom: 760 };
    expect(liftClear(chip, [approve, above])).toBe(876 - 700 + 8);
  });

  it("stays put rather than climb into the top of the screen", () => {
    const tall = { left: 900, right: 1400, top: 60, bottom: 870 };
    expect(liftClear(chip, [tall])).toBe(0);
  });
});
