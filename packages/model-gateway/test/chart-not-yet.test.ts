import { describe, expect, it } from "vitest";

import {
  CHART_NOT_YET_LINE,
  couldNotDoLine,
  couldNotLineFor,
} from "../src/q/index.js";

/**
 * Acceptance 2026-11-04 J6: "Show me a chart of Ledgerline's revenue" got
 * the figures, then "I tried, but it didn't go through". A chart has no
 * producer yet, so the ask is said plainly as not available, never as a
 * failure to retry, and no number is invented to draw one.
 */
describe("a chart they asked for, with none drawn", () => {
  it("is said plainly as not available yet, not as a failure", () => {
    const line = couldNotLineFor(
      "CALLED_DID_NOTHING",
      "Show me a chart of Ledgerline's revenue",
      "Ledgerline's self-reported revenue rises from ₦19.6m MRR in October 2025 to ₦38m in September 2026.",
    );
    expect(line).toBe(CHART_NOT_YET_LINE);
    expect(line).not.toMatch(/didn't go through|try again|ask me again/iu);
  });

  it("is not said twice when the answer already says it couldn't chart it", () => {
    expect(
      couldNotLineFor(
        "CALLED_DID_NOTHING",
        "Can you graph their MRR?",
        "Their MRR rose to ₦38m. I couldn't display the chart here, but the figures are in the deck.",
      ),
    ).toBeNull();
  });

  it("leaves every other miss with its own line", () => {
    expect(
      couldNotLineFor(
        "CALLED_DID_NOTHING",
        "Book a call with Maji Loop on Friday",
        "Okay.",
      ),
    ).toBe(couldNotDoLine("CALLED_DID_NOTHING"));
  });
});
