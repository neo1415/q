import { describe, expect, it } from "vitest";

import { currencyInWords } from "../src/voice/currency-names.js";

/**
 * Currency names from the runtime's Intl data, in every offered language
 * (owner 2026-10-17: no per-language word lists).
 */
const OFFERED = ["usd", "eur", "gbp", "ngn", "kes", "zar", "aed", "inr", "sgd"];

describe("currency in their words, any language", () => {
  it("full names and unit words, in English, Arabic and French", () => {
    for (const [text, code] of [
      ["about 500 thousand dollars", "USD"],
      ["نعم، نجمع حالياً مليوني دولار عبر SAFE", "USD"],
      ["بالدولار الأمريكي", "USD"],
      ["400 mille euros", "EUR"],
      ["عشرة ملايين درهم", "AED"],
      ["2 million Singapore dollars", "SGD"],
      ["50 million naira", "NGN"],
    ] as const) {
      expect(currencyInWords(text, OFFERED), text).toEqual({
        kind: "ONE",
        code,
      });
    }
  });

  it("another country's dollar is none of these; two currencies are several", () => {
    expect(currencyInWords("2 million Canadian dollars", OFFERED)).toEqual({
      kind: "OTHER",
    });
    expect(currencyInWords("2 millions de dollars canadiens", OFFERED)).toEqual(
      { kind: "OTHER" },
    );
    expect(currencyInWords("part euros, part dirhams", OFFERED)).toEqual({
      kind: "SEVERAL",
    });
  });

  it("a bare dollar follows the country they gave", () => {
    expect(
      currencyInWords("raising 2 million dollars", OFFERED, {
        countryCode: "SG",
      }),
    ).toEqual({ kind: "ONE", code: "SGD" });
  });
});

describe("generic scale and currency words beyond English and Arabic", () => {
  it("Hindi lakh with an inflected rupee, Swahili scale before the figure, and Europe is not the euro", () => {
    expect(currencyInWords("हम 10 लाख रुपये जुटा रहे हैं", OFFERED)).toEqual({
      kind: "ONE",
      code: "INR",
    });
    expect(currencyInWords("Tunakusanya shilingi milioni 2", OFFERED)).toEqual({
      kind: "ONE",
      code: "KES",
    });
    expect(
      currencyInWords("raising 2 million dollars to grow in Europe", OFFERED),
    ).toEqual({ kind: "ONE", code: "USD" });
  });
});
