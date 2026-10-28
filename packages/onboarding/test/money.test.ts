import { describe, expect, it } from "vitest";

import { parseFigure, parseMoney, parseMoneyAll } from "../src/index.js";

/**
 * Figures as real decks write them. The amount is a decimal string, never
 * a float; the currency is the one the text states, or null.
 */
describe("parseMoney · locale-aware figures", () => {
  it.each([
    ["₦450m", "450000000", "NGN", "MILLION"],
    ["NGN 1.2bn", "1200000000", "NGN", "BILLION"],
    ["KSh 120 mn", "120000000", "KES", "MILLION"],
    ["KES 3,500,000", "3500000", "KES", "ONE"],
    ["R15m", "15000000", "ZAR", "MILLION"],
    ["ZAR 2.5 million", "2500000", "ZAR", "MILLION"],
    ["£250k", "250000", "GBP", "THOUSAND"],
    ["€1.5m", "1500000", "EUR", "MILLION"],
    ["1,5 M€", "1500000", "EUR", "MILLION"],
    ["2,75 Mio. EUR", "2750000", "EUR", "MILLION"],
    ["AED 3 Mrd", "3000000000", "AED", "BILLION"],
    ["AED 12 thousand", "12000", "AED", "THOUSAND"],
    ["1 500 000 EUR", "1500000", "EUR", "ONE"],
    ["1 500 000 €", "1500000", "EUR", "ONE"],
    ["1.500.000 €", "1500000", "EUR", "ONE"],
    ["1.234.567,89 €", "1234567.89", "EUR", "ONE"],
    ["USD 1,234.56", "1234.56", "USD", "ONE"],
    ["US$ 4 MM", "4000000", "USD", "MILLION"],
    ["₹2 crore", "20000000", "INR", "CRORE"],
    ["450 million naira", "450000000", null, "MILLION"],
  ])("%s → %s %s", (text, amount, currency, unit) => {
    expect(parseMoney(text)).toMatchObject({ amount, currency, unit });
  });

  it("reads Arabic-Indic digits and Arabic scale words", () => {
    expect(parseMoney("الإيرادات ٤٥٠ مليون درهم")).toMatchObject({
      amount: "450000000",
      unit: "MILLION",
    });
    expect(parseMoney("AED ١٬٢٠٠٬٠٠٠")).toMatchObject({
      amount: "1200000",
      currency: "AED",
    });
    expect(parseMoney("۱٫۵ مليار")?.amount).toBe("1500000000");
  });

  it("marks a bare $ as uncertain rather than deciding it is USD for sure", () => {
    expect(parseMoney("$1.8m")).toMatchObject({
      amount: "1800000",
      currency: "USD",
      currencyCertain: false,
    });
    expect(parseMoney("US$1.8m")?.currencyCertain).toBe(true);
  });

  it("leaves the currency unknown when the text states none", () => {
    expect(parseMoney("1,000")).toMatchObject({
      amount: "1000",
      currency: null,
    });
  });

  it("prefers the figure that names a currency over a year before it", () => {
    expect(parseMoney("In 2025 we raised ₦450m")?.amount).toBe("450000000");
  });

  it("does not read a word that starts with a scale letter as the scale", () => {
    expect(parseMoney("5 months")).toMatchObject({ amount: "5", unit: "ONE" });
    expect(parseMoney("$41k MRR")).toMatchObject({ amount: "41000" });
  });

  it("never computes with floats: exact at any size", () => {
    expect(parseMoney("€0.1m")?.amount).toBe("100000");
    expect(parseMoney("9007199254740993 EUR")?.amount).toBe("9007199254740993");
  });

  it("finds every figure in a deck line, in order", () => {
    expect(
      parseMoneyAll("ARR ₦450m (2024: ₦120m)").map((m) => m.amount),
    ).toEqual(["450000000", "2024", "120000000"]);
  });

  it("parseFigure keeps its shape for the existing callers", () => {
    expect(parseFigure("$1.8m")).toBe("1800000");
    expect(parseFigure("£250k")).toBe("250000");
    expect(parseFigure("1,000")).toBe("1000");
    expect(parseFigure("3")).toBe("3");
    expect(parseFigure("2.5")).toBe("2.50");
    expect(parseFigure("1.005")).toBe("1.01");
    expect(parseFigure("none")).toBeNull();
    expect(parseFigure("1,5 M€")).toBe("1500000");
  });
});
