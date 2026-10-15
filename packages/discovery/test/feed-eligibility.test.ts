import { describe, expect, it } from "vitest";

import {
  admitToFeed,
  applyFeedEligibility,
  DISCOVER_FEED_ELIGIBILITY_CURRENT,
  DISCOVER_FEED_ELIGIBILITY_V1,
  DISCOVER_FEED_ELIGIBILITY_VERSIONS,
  DiscoverFeedEligibilitySchema,
  playablePitchPortFrom,
} from "../src/ranking/feed-eligibility.js";

const c = (companyId: string) => ({ companyId });
const OFF = DiscoverFeedEligibilitySchema.parse({
  version: "discover-feed-eligibility.v0",
  requirePlayablePitch: false,
  description: "test: no pitch requirement",
});

describe("discover-feed-eligibility (founder 2026-10-15)", () => {
  it("the current policy is v1, published once and frozen", () => {
    expect(DISCOVER_FEED_ELIGIBILITY_CURRENT).toBe(
      DISCOVER_FEED_ELIGIBILITY_V1,
    );
    expect(DISCOVER_FEED_ELIGIBILITY_VERSIONS.map((v) => v.version)).toEqual([
      "discover-feed-eligibility.v1",
    ]);
    expect(Object.isFrozen(DISCOVER_FEED_ELIGIBILITY_V1)).toBe(true);
  });

  it("admits only companies with a playable pitch, keeping input order", () => {
    const out = admitToFeed(
      DISCOVER_FEED_ELIGIBILITY_V1,
      [c("a"), c("b"), c("c")],
      new Set(["c", "a"]),
    );
    expect(out.admitted.map((x) => x.companyId)).toEqual(["a", "c"]);
    expect(out.withheld).toEqual(["b"]);
  });

  it("a policy that does not require a pitch admits everyone", () => {
    const out = admitToFeed(OFF, [c("a"), c("b")], new Set());
    expect(out.admitted.map((x) => x.companyId)).toEqual(["a", "b"]);
    expect(out.withheld).toEqual([]);
  });

  it("is deterministic: the same inputs give the same admission", () => {
    const run = () =>
      admitToFeed(
        DISCOVER_FEED_ELIGIBILITY_V1,
        [c("x"), c("y"), c("z")],
        new Set(["y"]),
      );
    expect(run()).toEqual(run());
  });

  it("fails closed without a port, and when the port fails", async () => {
    const none = await applyFeedEligibility({
      policy: DISCOVER_FEED_ELIGIBILITY_V1,
      port: undefined,
      candidates: [c("a")],
    });
    expect(none).toMatchObject({ admitted: [], confirmed: false });
    const failing = await applyFeedEligibility({
      policy: DISCOVER_FEED_ELIGIBILITY_V1,
      port: {
        companiesWithPlayablePitch: () => Promise.reject(new Error("down")),
      },
      candidates: [c("a")],
    });
    expect(failing).toMatchObject({
      admitted: [],
      withheld: ["a"],
      confirmed: false,
    });
  });

  it("asks nothing when the policy is off or there are no candidates", async () => {
    let asked = 0;
    const port = {
      companiesWithPlayablePitch: () => {
        asked += 1;
        return Promise.resolve(new Set<string>());
      },
    };
    await applyFeedEligibility({ policy: OFF, port, candidates: [c("a")] });
    await applyFeedEligibility({
      policy: DISCOVER_FEED_ELIGIBILITY_V1,
      port,
      candidates: [],
    });
    expect(asked).toBe(0);
  });

  it("reads Media's batched port in chunks no larger than its bound", async () => {
    const calls: number[] = [];
    const port = playablePitchPortFrom({
      batchMax: 2,
      findDiscoverablePitches: (ids) => {
        calls.push(ids.length);
        return Promise.resolve(
          new Map(ids.filter((i) => i !== "b").map((i) => [i, {}] as const)),
        );
      },
    });
    const found = await port.companiesWithPlayablePitch([
      "a",
      "b",
      "c",
      "a",
      "d",
      "e",
    ]);
    expect(calls).toEqual([2, 2, 1]);
    expect([...found].sort()).toEqual(["a", "c", "d", "e"]);
  });
});
