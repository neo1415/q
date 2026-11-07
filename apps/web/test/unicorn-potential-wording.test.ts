import { describe, expect, it } from "vitest";

import { UNICORN_POTENTIAL_CAVEAT } from "@capital-q/contracts";

import { translate, translatedStrings } from "../src/features/i18n/messages";

/**
 * Metrics audit P0-7, PADL #046: Unicorn Potential is a provisional
 * indicator (ADR 0076), never a forecast. No language may say "the
 * possibility of becoming a unicorn" or "a billion-dollar company", and the
 * caveat that says it is not a probability is translated.
 */
const FORECAST_WORDS = [
  /يونيكورن/u, // "unicorn" transliterated: reads as becoming one
  /المليارية/u, // "the billion-dollar (company)"
  /إمكانية أن تصبح/u, // "the possibility of becoming"
];

describe("Unicorn Potential wording", () => {
  const unicornKeys = translatedStrings("ar").filter((english) =>
    /unicorn/iu.test(english),
  );

  it("has Arabic for every Unicorn string, the caveat included", () => {
    expect(unicornKeys).toContain(UNICORN_POTENTIAL_CAVEAT);
    expect(translate("ar", UNICORN_POTENTIAL_CAVEAT)).not.toBe(
      UNICORN_POTENTIAL_CAVEAT,
    );
  });

  it("never reads as a forecast in Arabic", () => {
    expect(unicornKeys.length).toBeGreaterThan(10);
    for (const english of unicornKeys) {
      const arabic = translate("ar", english);
      for (const word of FORECAST_WORDS) expect(arabic).not.toMatch(word);
    }
  });

  it("the English caveat says it is not a probability", () => {
    expect(UNICORN_POTENTIAL_CAVEAT).toMatch(/not the probability/u);
  });
});
