import { describe, expect, it } from "vitest";

import { structuredValueFor } from "../src/intelligence/suggestions.js";

/** Break-it sweep 2026-10-03: "next six months" was recorded as 6–12 months. */
describe("a raise's timeframe in a founder's own words", () => {
  it.each(["next six months", "within 6 months", "in the next 6 months"])(
    "'%s' is 3–6 months",
    (said) => {
      expect(structuredValueFor("timeframe", said)).toEqual({
        type: "SINGLE_SELECT",
        optionKey: "3_6",
      });
    },
  );

  it("'6 to 12 months' stays 6–12", () => {
    expect(structuredValueFor("timeframe", "6 to 12 months")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "6_12",
    });
  });
});
