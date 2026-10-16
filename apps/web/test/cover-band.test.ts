import { describe, expect, it } from "vitest";

import { coverBandPaths } from "../src/features/entity/cover-band";

/** Live check 2026-10-16: a flat band read as a broken image. */
describe("the drawn cover band", () => {
  it("draws the same ridges for the same organisation, different ones for another", () => {
    const one = coverBandPaths("a0000000-0000-4000-8000-000000000001");
    expect(coverBandPaths("a0000000-0000-4000-8000-000000000001")).toEqual(one);
    expect(coverBandPaths("a0000000-0000-4000-8000-000000000002")).not.toEqual(
      one,
    );
  });

  it("stays inside the band, ridges closed to the bottom edge", () => {
    for (let n = 0; n < 50; n += 1) {
      const { far, near } = coverBandPaths(`seed-${String(n)}`);
      for (const path of [far, near]) {
        const numbers = (path.match(/-?\d+(\.\d+)?/gu) ?? []).map(Number);
        expect(numbers.every((v) => v >= 0 && v <= 400)).toBe(true);
        expect(path.endsWith("L400 100 L0 100 Z")).toBe(true);
      }
    }
  });
});
