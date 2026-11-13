import { describe, expect, it } from "vitest";

import { latestPerClaimKey } from "../src/investability/observe.js";

/**
 * 13 Nov (A8): dated monthly readings of one metric are its history, not
 * more evidence. The investability reading observes only the latest dated
 * reading per claim key; a contradiction on the latest date stays.
 */
const claim = (id: string, claimKey: string, validFrom: string | null) => ({
  id,
  claimKey,
  validFrom,
});

describe("claim history is not more evidence", () => {
  it("keeps the latest dated reading per key", () => {
    const kept = latestPerClaimKey([
      claim("jun", "revenue.mrr", "2026-06-30"),
      claim("sep", "revenue.mrr", "2026-09-30"),
      claim("aug", "revenue.mrr", "2026-08-31"),
      claim("team", "team.size", null),
    ]);
    expect(kept.map((c) => c.id)).toEqual(["sep", "team"]);
  });

  it("a dated reading beats an undated one; with no dates every reading stays", () => {
    expect(
      latestPerClaimKey([
        claim("undated", "revenue.mrr", null),
        claim("dated", "revenue.mrr", "2026-09-30"),
      ]).map((c) => c.id),
    ).toEqual(["dated"]);
    expect(
      latestPerClaimKey([
        claim("a", "customers", null),
        claim("b", "customers", null),
      ]).map((c) => c.id),
    ).toEqual(["a", "b"]);
  });

  it("two readings on the same latest date both stay (a contradiction is never hidden)", () => {
    expect(
      latestPerClaimKey([
        claim("x", "revenue.mrr", "2026-09-30"),
        claim("y", "revenue.mrr", "2026-09-30"),
        claim("old", "revenue.mrr", "2026-08-31"),
      ]).map((c) => c.id),
    ).toEqual(["x", "y"]);
  });
});
