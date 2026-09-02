import { describe, expect, it } from "vitest";

import { CurrencyCodeSchema, MoneySchema } from "../src/common/money.js";
import { PercentageSchema } from "../src/common/percentage.js";

describe("CurrencyCodeSchema", () => {
  it.each(["USD", "NGN", "GBP", "EUR"])("accepts %s", (code) => {
    expect(CurrencyCodeSchema.parse(code)).toBe(code);
  });

  it.each(["usd", "Usd", "US", "USDD", "", "US1", "$"])(
    "rejects %s",
    (code) => {
      expect(CurrencyCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe("MoneySchema", () => {
  it("accepts an exact amount with an explicit currency", () => {
    expect(
      MoneySchema.parse({ amount: "2000000.00", currency: "USD" }),
    ).toEqual({ amount: "2000000.00", currency: "USD" });
  });

  it("rejects a numeric amount", () => {
    // Floating point money is the defect this primitive exists to prevent.
    expect(
      MoneySchema.safeParse({ amount: 2000000.0, currency: "USD" }).success,
    ).toBe(false);
  });

  it("rejects a lowercase or malformed currency", () => {
    expect(
      MoneySchema.safeParse({ amount: "10.00", currency: "usd" }).success,
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount: "10.00", currency: "DOLLARS" }).success,
    ).toBe(false);
  });

  it("rejects a malformed decimal amount", () => {
    expect(
      MoneySchema.safeParse({ amount: "1,000.00", currency: "USD" }).success,
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ amount: "1e6", currency: "USD" }).success,
    ).toBe(false);
  });

  it("requires the currency to be present", () => {
    // An amount without a currency is not money.
    expect(MoneySchema.safeParse({ amount: "10.00" }).success).toBe(false);
  });

  it("allows negative amounts, leaving sign rules to the domain", () => {
    // Refunds and accounting adjustments are legitimately negative; "must be
    // positive" belongs to the domain that means it, not to the representation.
    expect(
      MoneySchema.safeParse({ amount: "-500.00", currency: "USD" }).success,
    ).toBe(true);
  });
});

describe("PercentageSchema", () => {
  it("requires the unit to be stated explicitly", () => {
    expect(PercentageSchema.parse({ value: "25.0", unit: "PERCENT" })).toEqual({
      value: "25.0",
      unit: "PERCENT",
    });
  });

  it("rejects a bare number, which is the ambiguity it exists to remove", () => {
    // 0.25 or 25? A bare number cannot say.
    expect(PercentageSchema.safeParse(25).success).toBe(false);
    expect(PercentageSchema.safeParse("25").success).toBe(false);
    expect(PercentageSchema.safeParse({ value: "25.0" }).success).toBe(false);
  });

  it("rejects an unknown unit", () => {
    expect(
      PercentageSchema.safeParse({ value: "0.25", unit: "RATIO" }).success,
    ).toBe(false);
  });

  it("permits values outside 0-100, leaving bounds to the domain", () => {
    // Growth and variance metrics legitimately exceed 100 or go negative.
    expect(
      PercentageSchema.safeParse({ value: "250.0", unit: "PERCENT" }).success,
    ).toBe(true);
    expect(
      PercentageSchema.safeParse({ value: "-12.5", unit: "PERCENT" }).success,
    ).toBe(true);
  });
});
