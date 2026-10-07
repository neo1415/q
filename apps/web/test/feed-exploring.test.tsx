import { describe, expect, it } from "vitest";

import { exploringLine } from "../src/features/discover/feed-card";

/**
 * Q.06: Discover is ordered by fit, so a company placed by the
 * exploration or diversity policy (and only such a company) is labelled.
 */
describe("exploring label", () => {
  it("labels exploration and diversity placements in words", () => {
    expect(exploringLine(["EXPLORATION_SLOT", "STAGE_ALIGNED"])).toMatch(
      /^Exploring/,
    );
    expect(exploringLine(["DIVERSITY_ADJUSTMENT"])).toMatch(/^Exploring/);
  });

  it("says nothing for a company placed by fit", () => {
    expect(exploringLine(["STAGE_ALIGNED", "TAXONOMY_EXACT"])).toBeNull();
    expect(exploringLine([])).toBeNull();
  });
});
