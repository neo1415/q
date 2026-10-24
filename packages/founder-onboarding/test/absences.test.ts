import { describe, expect, it } from "vitest";

import {
  structuredValueFor,
  withoutAbsences,
} from "../src/intelligence/suggestions.js";

/**
 * QA F-51 (23 Oct 2026): the read-back asked a founder to "Keep" lines
 * like "No moat stated." An absence is a gap to fill, never a fact.
 */
describe("an absence is never proposed as a fact", () => {
  it("drops a proposal that only says something is missing", () => {
    for (const said of [
      "No moat stated.",
      "No competition stated.",
      "No vision stated.",
      "No website stated.",
      "The deck does not mention a moat.",
      "None provided.",
    ]) {
      expect(withoutAbsences(said)).toBe("");
    }
    expect(structuredValueFor("moats", "No moat stated.")).toBeNull();
  });

  it("keeps what the deck does say beside an absence", () => {
    expect(
      withoutAbsences(
        "No explicit go-to-market method stated; expansion includes targeting 150 clinics and launching in Lagos.",
      ),
    ).toBe("expansion includes targeting 150 clinics and launching in Lagos.");
    expect(withoutAbsences("Network effects across 1,140 clinics.")).toBe(
      "Network effects across 1,140 clinics.",
    );
  });
});
