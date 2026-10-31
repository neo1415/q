import { describe, expect, it } from "vitest";

import {
  FIT_ORDER_CURRENT,
  FIT_ORDER_V2,
  discoverOrderValue,
  orderByFit,
  type FitOrderKey,
} from "../src/fit/order.js";

/**
 * fit-order.v2 (owner 2026-10-16): Investability enters the Discover order
 * only through the versioned weights, after explicit fit. Unknown
 * Investability is absent (never low); a candidate with no fit score keeps
 * its base position whatever its Investability.
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function key(fit: number | null, investability: number | null): FitOrderKey {
  return {
    assessment: null,
    score: fit,
    orderValue: discoverOrderValue(fit, investability),
  };
}

const base = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({
    companyId: ID(i + 1),
    baseRank: i + 1,
  }));

describe("discover order with Investability (fit-order.v2)", () => {
  it("is the current, versioned policy with explicit weights", () => {
    expect(FIT_ORDER_CURRENT.version).toBe("fit-order.v4");
    expect(FIT_ORDER_V2.weights.suitability).toBeGreaterThan(
      FIT_ORDER_V2.weights.investability,
    );
    expect(Object.isFrozen(FIT_ORDER_V2.weights)).toBe(true);
  });

  it("computes the order value from the config, never from absent evidence", () => {
    expect(discoverOrderValue(null, 90)).toBeNull();
    expect(discoverOrderValue(8, null)).toBe(80);
    expect(discoverOrderValue(8, 40)).toBeCloseTo(0.75 * 80 + 0.25 * 40, 10);
    // The weights are the config's: a different config orders differently.
    expect(
      discoverOrderValue(8, 40, { suitability: 1, investability: 1 }),
    ).toBe(60);
  });

  it("orders equally fitting companies by Investability", () => {
    const keys = new Map([
      [ID(1), key(8, 40)],
      [ID(2), key(8, 80)],
    ]);
    expect(orderByFit(base(2), keys).map((o) => o.companyId)).toEqual([
      ID(2),
      ID(1),
    ]);
  });

  it("keeps fit first: Investability cannot overturn a large fit gap", () => {
    const keys = new Map([
      [ID(1), key(6, 100)],
      [ID(2), key(10, 0)],
    ]);
    expect(orderByFit(base(2), keys).map((o) => o.companyId)).toEqual([
      ID(2),
      ID(1),
    ]);
  });

  it("never promotes a company the fit cannot score", () => {
    const keys = new Map([
      [ID(1), key(7, 50)],
      [ID(2), key(null, 100)],
      [ID(3), key(9, 60)],
    ]);
    const order = orderByFit(base(3), keys);
    // The unscored candidate keeps its base position 2.
    expect(order[1]?.companyId).toBe(ID(2));
    expect(order.map((o) => o.companyId)).toEqual([ID(3), ID(2), ID(1)]);
  });

  it("unknown Investability is never read as low", () => {
    const keys = new Map([
      [ID(1), key(8, null)],
      [ID(2), key(8, 80)],
      [ID(3), key(8, null)],
    ]);
    const order = orderByFit(base(3), keys);
    // 80 (unknown: fit alone) ties 80 (known 80): the base rank decides.
    expect(order.map((o) => o.companyId)).toEqual([ID(1), ID(2), ID(3)]);
    expect(order.every((o) => o.internalScore === 0.8)).toBe(true);
  });

  it("is deterministic", () => {
    const keys = new Map([
      [ID(1), key(7, 30)],
      [ID(2), key(7, 90)],
      [ID(3), key(5, 100)],
    ]);
    const a = orderByFit(base(3), keys);
    const b = orderByFit(base(3), keys);
    expect(a).toEqual(b);
  });
});
