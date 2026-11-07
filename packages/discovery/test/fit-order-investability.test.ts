import { describe, expect, it } from "vitest";

import {
  FIT_ORDER_CURRENT,
  FIT_ORDER_V2,
  FIT_ORDER_V5,
  discoverOrderValue,
  orderByFit,
  type FitOrderKey,
} from "../src/fit/order.js";

/**
 * fit-order.v5 (metrics audit P0-5/P1-2): fit first, as the feed says.
 * Investability orders only among equal fits out of 10; unknown
 * Investability keeps its position (never read as low or as high); a
 * candidate with no fit score keeps its base position.
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function key(fit: number | null, investability: number | null): FitOrderKey {
  return { assessment: null, score: fit, investability };
}

const base = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({
    companyId: ID(i + 1),
    baseRank: i + 1,
  }));

const ids = (order: readonly { companyId: string }[]) =>
  order.map((o) => o.companyId);

describe("discover order with Investability (fit-order.v5)", () => {
  it("is the current, versioned policy, with nothing blended", () => {
    expect(FIT_ORDER_CURRENT.version).toBe("fit-order.v5");
    expect(FIT_ORDER_V5.investability).toBe("TIE_BREAK_WITHIN_EQUAL_FIT");
    expect("weights" in FIT_ORDER_V5).toBe(false);
    // The v2 blend stays reproducible for history.
    expect(discoverOrderValue(8, 40, FIT_ORDER_V2.weights)).toBeCloseTo(70);
  });

  it("a higher fit out of 10 is never below a lower one, whatever Investability says", () => {
    const keys = new Map([
      [ID(1), key(6, 100)],
      [ID(2), key(8, 0)],
    ]);
    expect(ids(orderByFit(base(2), keys))).toEqual([ID(2), ID(1)]);
  });

  it("orders equally fitting companies by Investability", () => {
    const keys = new Map([
      [ID(1), key(8, 40)],
      [ID(2), key(8, 80)],
    ]);
    expect(ids(orderByFit(base(2), keys))).toEqual([ID(2), ID(1)]);
  });

  it("unknown Investability keeps its position among equal fits", () => {
    const keys = new Map([
      [ID(1), key(8, 30)],
      [ID(2), key(8, null)],
      [ID(3), key(8, 90)],
    ]);
    // Positions 1 and 3 hold the known ones, refilled by Investability;
    // the unknown keeps position 2: neither promoted nor buried.
    expect(ids(orderByFit(base(3), keys))).toEqual([ID(3), ID(2), ID(1)]);
  });

  it("sharing less evidence never ranks higher", () => {
    const keys = new Map([
      [ID(1), key(7, null)],
      [ID(2), key(8, 10)],
    ]);
    expect(ids(orderByFit(base(2), keys))).toEqual([ID(2), ID(1)]);
  });

  it("never promotes a company the fit cannot score", () => {
    const keys = new Map([
      [ID(1), key(7, 50)],
      [ID(2), key(null, 100)],
      [ID(3), key(9, 60)],
    ]);
    const order = orderByFit(base(3), keys);
    expect(order[1]?.companyId).toBe(ID(2));
    expect(ids(order)).toEqual([ID(3), ID(2), ID(1)]);
  });

  it("the internal score is the fit alone", () => {
    const keys = new Map([[ID(1), key(8, 100)]]);
    expect(orderByFit(base(1), keys)[0]?.internalScore).toBe(0.8);
  });

  it("is deterministic", () => {
    const keys = new Map([
      [ID(1), key(7, 30)],
      [ID(2), key(7, 90)],
      [ID(3), key(5, 100)],
    ]);
    expect(orderByFit(base(3), keys)).toEqual(orderByFit(base(3), keys));
  });
});
