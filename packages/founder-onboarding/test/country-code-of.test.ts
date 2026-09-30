import { describe, expect, it } from "vitest";

import { countryCodeOf } from "../src/integration/write-targets.js";

/**
 * A country outside the short list is still a country (founder direction
 * 2026-09-30): the person's own words become its ISO code.
 */
describe("countryCodeOf", () => {
  it("reads a country named in words as its ISO code", () => {
    expect(countryCodeOf("Uzbekistan")).toBe("UZ");
    expect(countryCodeOf("  united states ")).toBe("US");
    expect(countryCodeOf("Rwanda")).toBe("RW");
  });

  it("leaves words that name no country unknown", () => {
    expect(countryCodeOf("somewhere nice")).toBeNull();
    expect(countryCodeOf(null)).toBeNull();
    expect(countryCodeOf("")).toBeNull();
  });
});
