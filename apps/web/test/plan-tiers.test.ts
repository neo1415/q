import { describe, expect, it } from "vitest";

import {
  PLAN_TIERS,
  tierOfPlan,
  tierPrice,
} from "@/features/billing/plan-tiers";

describe("billing plan tiers config", () => {
  it("is versioned, in one currency and marked as a preview", () => {
    expect(PLAN_TIERS.version).toBeGreaterThanOrEqual(1);
    expect(PLAN_TIERS.currency).toMatch(/^[A-Z]{3}$/u);
    expect(PLAN_TIERS.preview).toBe(true);
  });

  it("has unique keys, plain decimal prices and something to say", () => {
    const keys = PLAN_TIERS.tiers.map((tier) => tier.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["founder", "investor", "fund"]);
    for (const tier of PLAN_TIERS.tiers) {
      // Money is a decimal string, never a float.
      expect(typeof tier.monthly).toBe("string");
      expect(tier.monthly).toMatch(/^\d{1,7}\.\d{2}$/u);
      expect(tier.highlights.length).toBeGreaterThan(0);
      expect(tier.name.length).toBeGreaterThan(0);
    }
  });

  it("maps a billing-service plan key to at most one tier", () => {
    const all = PLAN_TIERS.tiers.flatMap((tier) => [...tier.planKeys]);
    expect(new Set(all).size).toBe(all.length);
    expect(tierOfPlan("founder")?.key).toBe("founder");
    expect(tierOfPlan("launch")).toBeNull();
  });

  it("formats prices for people", () => {
    expect(tierPrice("49.00")).toBe("$49");
    expect(tierPrice("990.00")).toBe("$990");
    expect(tierPrice("1490.50")).toBe("$1,490.50");
    expect(tierPrice(null)).toBe("Talk to us");
    expect(tierPrice("10.00", "GBP")).toBe("GBP 10");
  });
});
