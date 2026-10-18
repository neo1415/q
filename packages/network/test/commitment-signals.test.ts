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

/**
 * meet2-64 (live 2026-10-04): "I'm going to give you one million dollars"
 * was written down by the notes as "a million dollars" and never filed.
 */
describe("money said in words", () => {
  it.each([
    ["a million dollars", "1000000", "USD"],
    ["one million dollars", "1000000", "USD"],
    ["$1 million", "1000000", "USD"],
    ["two million naira", "2000000", "NGN"],
    ["a hundred thousand pounds", "100000", "GBP"],
    ["about 250k dollars", "250000", "USD"],
    ["give you one million dollars", "1000000", "USD"],
    ["$500,000 for the round", "500000", "USD"],
    ["we'll commit to $500k", "500000", "USD"],
  ])("reads %s", (text, amount, currencyCode) => {
    expect(parseSpokenAmount(text)).toEqual({ amount, currencyCode });
  });

  it.each([
    "half a million dollars",
    "a few hundred thousand dollars",
    "$500,000 for a million dollars",
    "a million",
    "one or two million dollars",
    "1 to 2 million dollars",
    "€5 million dollars",
    "zero dollars",
  ])("leaves %s unknown", (text) => {
    expect(parseSpokenAmount(text)).toBeNull();
  });
});
