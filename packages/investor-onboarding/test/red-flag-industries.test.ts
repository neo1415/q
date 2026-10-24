import { describe, expect, it } from "vitest";

import { RED_FLAG_INDUSTRY_CODES } from "@capital-q/taxonomy/reference-data";

import { RED_FLAG_OPTIONS } from "../src/definition/investor-v1.js";

/**
 * QO-28b: Discover reads an investor's red-flag code against the industry
 * node of the same code. Every such node must be a red flag the investor
 * can actually choose, or the exclusion could never be declared.
 */
describe("red-flag industries", () => {
  it("name only red flags the investor journey offers", () => {
    const offered = RED_FLAG_OPTIONS.map((option) => option.optionKey);
    expect(RED_FLAG_INDUSTRY_CODES.length).toBeGreaterThan(0);
    for (const code of RED_FLAG_INDUSTRY_CODES) {
      expect(offered, code).toContain(code);
    }
  });
});
