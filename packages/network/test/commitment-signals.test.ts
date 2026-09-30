import { describe, expect, it } from "vitest";

import { parseSpokenAmount, sideOfParty } from "../src/index.js";

/**
 * Founder direction 2026-09-30: Q files money it heard in a call. Only an
 * exact figure with a known currency is filed; anything vague stays
 * unknown rather than guessed.
 */
describe("money Q heard", () => {
  it.each([
    ["$500k", "500000", "USD"],
    ["$1.5m", "1500000", "USD"],
    ["US$250,000", "250000", "USD"],
    ["USD 2 million", "2000000", "USD"],
    ["€300k", "300000", "EUR"],
    ["£75,000", "75000", "GBP"],
    ["₦50m", "50000000", "NGN"],
    ["KSh 10m", "10000000", "KES"],
    ["2.25m USD", "2250000", "USD"],
    ["250,000 USD", "250000", "USD"],
    ["5 million EUR", "5000000", "EUR"],
    ["$1,234.5", "1234.50", "USD"],
  ])("reads %s exactly", (text, amount, currencyCode) => {
    expect(parseSpokenAmount(text)).toEqual({ amount, currencyCode });
  });

  it.each([
    "half a million",
    "a few hundred k",
    "500k",
    "R 5m",
    "$",
    "$0",
    "XYZ 5m",
    "$5 zillion",
    "$1.234k5",
    "€5m USD",
  ])("leaves %s unknown", (text) => {
    expect(parseSpokenAmount(text)).toBeNull();
  });

  it("keeps fractions of a cent out rather than rounding them in", () => {
    expect(parseSpokenAmount("$1.2345")).toBeNull();
  });

  it("names the side only when the record says who spoke", () => {
    const attendees = [
      { name: "Kemi Ade", side: "INVESTOR" as const },
      { name: "Tolu", side: "FOUNDER" as const },
      { name: "Guest", side: null },
    ];
    expect(sideOfParty("kemi ade", attendees)).toBe("INVESTOR");
    expect(sideOfParty("Tolu", attendees)).toBe("COMPANY");
    expect(sideOfParty("Guest", attendees)).toBeNull();
    expect(sideOfParty("Someone else", attendees)).toBeNull();
  });
});
