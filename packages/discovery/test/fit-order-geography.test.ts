import { describe, expect, it } from "vitest";

import {
  FIT_ORDER_CURRENT,
  FIT_ORDER_V3,
  discoverOrderValue,
  orderByFit,
  outsideDeclaredGeography,
  type FitOrderKey,
} from "../src/fit/order.js";

/**
 * fit-order.v3 (live 2026-10-31, "Halvmåne Partners": geography Nordics
 * and Germany declared Strong): v2 ranked Karoo Gridworks (South Africa,
 * sector match) first and Kycana Hub (in region, sector mismatch) fourth.
 * A geography the investor declared Must or Strong now orders scored
 * out-of-region companies after the rest; unknown is never out of region.
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function key(
  fit: number | null,
  geography: string,
  strength: "MUST" | "STRONG" | "NICE" | undefined,
): FitOrderKey {
  return {
    assessment: null,
    score: fit,
    orderValue: discoverOrderValue(fit, null),
    outsideDeclaredGeography: outsideDeclaredGeography(geography, strength),
  };
}

const base = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({
    companyId: ID(i + 1),
    baseRank: i + 1,
  }));

describe("discover order with a declared geography (fit-order.v3, v4)", () => {
  it("is the current, versioned policy, with v2's weights", () => {
    expect(FIT_ORDER_CURRENT.version).toBe("fit-order.v4");
    expect(FIT_ORDER_V3.geographyFirst).toEqual(["MUST", "STRONG"]);
    expect(Object.isFrozen(FIT_ORDER_V3)).toBe(true);
  });

  it("puts the in-region company above out-of-region ones a sector match lifted (live case)", () => {
    // Karoo Gridworks 6.7, Kivu Traceworks 6.7, Portside 6.0: out of
    // region; Kycana Hub 5.9: in region.
    const keys = new Map([
      [ID(1), key(6.7, "MISMATCH", "STRONG")],
      [ID(2), key(6.7, "MISMATCH", "STRONG")],
      [ID(3), key(6.0, "MISMATCH", "STRONG")],
      [ID(4), key(5.9, "STRONG", "STRONG")],
    ]);
    expect(orderByFit(base(4), keys).map((o) => o.companyId)).toEqual([
      ID(4),
      ID(1),
      ID(2),
      ID(3),
    ]);
  });

  it("never reads an unknown location as out of region", () => {
    const keys = new Map([
      [ID(1), key(5, "UNKNOWN", "STRONG")],
      [ID(2), key(9, "MISMATCH", "STRONG")],
      [ID(3), key(7, "PARTIAL", "MUST")],
    ]);
    expect(orderByFit(base(3), keys).map((o) => o.companyId)).toEqual([
      ID(3),
      ID(1),
      ID(2),
    ]);
  });

  it("adds no tier for a 'nice to have' or undeclared geography", () => {
    for (const strength of ["NICE", undefined] as const) {
      const keys = new Map([
        [ID(1), key(6, "STRONG", strength)],
        [ID(2), key(8, "MISMATCH", strength)],
      ]);
      expect(orderByFit(base(2), keys).map((o) => o.companyId)).toEqual([
        ID(2),
        ID(1),
      ]);
    }
  });

  it("fit-order.v4: the tier holds for unscored candidates too; within a tier they keep their places", () => {
    const keys = new Map([
      [ID(1), key(9, "MISMATCH", "STRONG")],
      [ID(2), key(null, "MISMATCH", "STRONG")],
      [ID(3), key(5, "STRONG", "STRONG")],
    ]);
    expect(orderByFit(base(3), keys).map((o) => o.companyId)).toEqual([
      ID(3),
      ID(1),
      ID(2),
    ]);
    // Without a declared tier, an unscored candidate keeps its base place.
    const plain = new Map([
      [ID(1), key(5, "MISMATCH", "NICE")],
      [ID(2), key(null, "MISMATCH", "NICE")],
      [ID(3), key(9, "STRONG", "NICE")],
    ]);
    expect(orderByFit(base(3), plain).map((o) => o.companyId)).toEqual([
      ID(3),
      ID(2),
      ID(1),
    ]);
  });

  it("fit-order.v4: an unscored in-region company is not left behind out-of-region ones (live 2026-10-31, Stackisk Hub 18th)", () => {
    // Seventeen scored out-of-region companies, then Stackisk Hub (DE,
    // unscored: stage mismatch) at base 18, then more out of region.
    const keys = new Map<string, FitOrderKey>();
    for (let n = 1; n <= 20; n += 1)
      keys.set(ID(n), key(n === 18 ? null : 9 - n / 10, "MISMATCH", "STRONG"));
    keys.set(ID(18), key(null, "STRONG", "STRONG"));
    const order = orderByFit(base(20), keys);
    expect(order[0]?.companyId).toBe(ID(18));
    expect(order.map((o) => o.rank)).toEqual(
      Array.from({ length: 20 }, (_v, i) => i + 1),
    );
    expect(new Set(order.map((o) => o.companyId)).size).toBe(20);
  });
});
