import { describe, expect, it } from "vitest";

import {
  chooseBuildMembership,
  type BuildMembership,
} from "../src/recommendations/build-principal.js";

/**
 * Who a background slate build acts as (CQ-REC-006 C, audited in
 * CQ-REC-007R D).
 *
 * The rule used to be "the mandate's creator", full stop, and that made
 * one person a single point of failure for their whole organisation: the
 * refresh handler dead-letters a job with no principal PERMANENTLY, so
 * when that person left, the organisation's slate stopped rebuilding for
 * good. The test below that matters is the second one.
 */

const member = (id: string, userId: string): BuildMembership => ({
  membership: { id, userId },
});

const CREATOR = member("m-creator", "u-creator");
const OLDEST = member("m-oldest", "u-oldest");
const NEWER = member("m-newer", "u-newer");

describe("choosing a build principal", () => {
  it("prefers the mandate's creator while their membership is active", () => {
    // Changing principal can change what the slate contains, so it is not
    // changed for no reason.
    expect(chooseBuildMembership(CREATOR, [OLDEST, NEWER])).toBe(CREATOR);
  });

  it("keeps building after the creator leaves, instead of stopping forever", () => {
    expect(chooseBuildMembership(null, [OLDEST, NEWER])).toBe(OLDEST);
  });

  it("picks the same member every time from the same rows", () => {
    // The query orders by (joined_at, id); taking the first of that is
    // what makes a rebuild reproducible rather than whoever turns up.
    const once = chooseBuildMembership(null, [OLDEST, NEWER]);
    const twice = chooseBuildMembership(null, [OLDEST, NEWER]);
    expect(once).toBe(twice);
  });

  it("returns nobody only when the organisation has no active member", () => {
    // The one case where there is genuinely nobody to build as, and the
    // only one that should still dead-letter.
    expect(chooseBuildMembership(null, [])).toBeNull();
  });
});
