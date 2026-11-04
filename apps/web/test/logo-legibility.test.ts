import { describe, expect, it } from "vitest";

import { isUnreadableLogo } from "@/features/entity/logo-legibility";

/** A square sample: `ground` everywhere, `mark` on a centre band. */
function sample(
  ground: readonly [number, number, number, number],
  mark: readonly [number, number, number, number],
  side = 24,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const onMark = y > side / 3 && y < (2 * side) / 3 && x > 4 && x < 20;
      data.set(onMark ? mark : ground, (y * side + x) * 4);
    }
  }
  return data;
}

/**
 * Acceptance 2026-11-04 J5: Mizan's and Silo Credit's logos showed as
 * black squares -- opaque black with a near-black mark (sampled from the
 * receipt: (0,0,0) ground, (42,14,19) and (36,26,16) letters).
 */
describe("a logo that tells the reader nothing is no picture", () => {
  it("dark marks on an opaque black ground are unreadable (the receipt's colours)", () => {
    expect(isUnreadableLogo(sample([0, 0, 0, 255], [42, 14, 19, 255]))).toBe(
      true,
    );
    expect(isUnreadableLogo(sample([0, 0, 0, 255], [36, 26, 16, 255]))).toBe(
      true,
    );
  });

  it("a white-on-black mark is a real logo and is kept", () => {
    expect(isUnreadableLogo(sample([0, 0, 0, 255], [255, 255, 255, 255]))).toBe(
      false,
    );
  });

  it("a dark mark on a clear ground sits on the light tile and is kept", () => {
    expect(isUnreadableLogo(sample([0, 0, 0, 0], [20, 20, 20, 255]))).toBe(
      false,
    );
  });

  it("an ordinary light logo is kept, and an empty read judges nothing", () => {
    expect(
      isUnreadableLogo(sample([255, 255, 255, 255], [180, 30, 40, 255])),
    ).toBe(false);
    expect(isUnreadableLogo(new Uint8ClampedArray(0))).toBe(false);
  });
});
