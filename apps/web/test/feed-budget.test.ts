import { describe, expect, it } from "vitest";

import {
  CONSTRAINED_PREFETCH_BUDGET,
  DEFAULT_PREFETCH_BUDGET,
} from "../src/features/discover/feed/feed-state";
import { budgetFor } from "../src/features/discover/feed/use-feed-budget";

/**
 * The warm tier is billed per delivered minute, so it is withheld where the
 * browser says the link is slow or the person asked to save data. A browser
 * that says nothing (Safari, iOS, Firefox) gets the full window: silence is
 * not a slow link (doc 20 §52), and treating it as one left every iPhone
 * swipe cold.
 */
describe("the feed's preload budget", () => {
  it("is the full window on 4g with Save-Data off", () => {
    expect(budgetFor({ effectiveType: "4g", saveData: false })).toBe(
      DEFAULT_PREFETCH_BUDGET,
    );
    expect(budgetFor({ effectiveType: "4g" })).toBe(DEFAULT_PREFETCH_BUDGET);
  });

  it("is constrained when the person asked to save data", () => {
    expect(budgetFor({ effectiveType: "4g", saveData: true })).toBe(
      CONSTRAINED_PREFETCH_BUDGET,
    );
  });

  it("is constrained on a slower link", () => {
    for (const effectiveType of ["3g", "2g", "slow-2g"]) {
      expect(budgetFor({ effectiveType })).toBe(CONSTRAINED_PREFETCH_BUDGET);
    }
  });

  it("is the full window when the browser does not say", () => {
    expect(budgetFor(undefined)).toBe(DEFAULT_PREFETCH_BUDGET);
    expect(budgetFor({})).toBe(DEFAULT_PREFETCH_BUDGET);
  });

  it("is constrained by Save-Data even when the link type is unknown", () => {
    expect(budgetFor({ saveData: true })).toBe(CONSTRAINED_PREFETCH_BUDGET);
  });
});
