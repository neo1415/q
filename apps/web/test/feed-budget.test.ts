import { describe, expect, it } from "vitest";

import {
  CONSTRAINED_PREFETCH_BUDGET,
  DEFAULT_PREFETCH_BUDGET,
} from "../src/features/discover/feed/feed-state";
import { budgetFor } from "../src/features/discover/feed/use-feed-budget";

/**
 * The warm tier is billed per delivered minute, so it is earned: only a
 * fast link with Save-Data off gets it. Every other answer, including "the
 * browser did not say", is the constrained window.
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

  it("is constrained when the browser does not say", () => {
    expect(budgetFor(undefined)).toBe(CONSTRAINED_PREFETCH_BUDGET);
    expect(budgetFor({})).toBe(CONSTRAINED_PREFETCH_BUDGET);
  });
});
