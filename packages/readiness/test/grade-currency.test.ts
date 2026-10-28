import { describe, expect, it } from "vitest";

import {
  gradeMarket,
  gradeTraction,
  moneyOf,
} from "../src/investability/grade.js";

/**
 * Stress 2026-10-28 I03: Ledgerline's deck says "MRR ₦38m" and
 * "Annualised MRR About ₦456m". The annualised figure was read as monthly
 * (its label says MRR) and shown converted as "About $296k a month in
 * revenue". A statement must keep the stated currency; conversion is only
 * an internal banding aid.
 */
describe("traction grading keeps the stated currency", () => {
  const ledgerline = [
    { label: "Paying businesses", value: "1,140" },
    { label: "MRR", value: "₦38m" },
    { label: "Annualised MRR", value: "About ₦456m" },
    {
      label: "MRR history",
      value: "₦19.6m to ₦38m from October 2025 to September 2026",
    },
  ];

  it("states ₦38m a month, never a dollar figure", () => {
    const traction = gradeTraction(ledgerline, "SEED").find(
      (g) => g.criterion === "cp.traction",
    );
    expect(traction?.statement).toBe("₦38m a month in revenue (as stated)");
    expect(traction?.statement).not.toMatch(/\$/u);
    // ₦38m ≈ $25k a month: typical for seed (2), never "above typical".
    expect(traction?.anchor).toBe(2);
  });

  it("reads an annualised figure as a year, not a month", () => {
    const g = gradeTraction(
      [{ label: "Annualised MRR", value: "About ₦456m" }],
      "SEED",
    );
    expect(g[0]?.statement).toBe("₦456m a year in revenue (as stated)");
    expect(g[0]?.anchor).toBe(2);
  });

  it("keeps a dollar figure as written", () => {
    const g = gradeTraction([{ label: "MRR", value: "$65,000" }], "SEED");
    expect(g[0]?.statement).toBe("$65,000 a month in revenue (as stated)");
  });

  it("quotes a market size in its own currency", () => {
    const g = gradeMarket([{ label: "Market (TAM)", value: "₦2.4bn" }]);
    expect(g[0]?.statement).toBe("Market sized at ₦2.4bn (as stated)");
  });

  it("moneyOf returns the stated text and a banding value", () => {
    expect(moneyOf("About ₦456m")).toEqual({
      stated: "₦456m",
      usd: 456e6 * 0.00065,
    });
  });
});
