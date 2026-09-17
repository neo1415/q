import { describe, expect, it } from "vitest";

import { stripEmptyPromises } from "../src/index.js";

/**
 * The tic, and the sentences that only look like it.
 */
describe("a promise with nothing behind it", () => {
  it("removes an opening that only announces the work", () => {
    const cases = [
      "Let me check that. Paystack processes payments across Africa.",
      "One second. Paystack processes payments across Africa.",
      "Hold on, checking. Paystack processes payments across Africa.",
      "I'll look that up. Paystack processes payments across Africa.",
      "Give me a moment on that. Paystack processes payments across Africa.",
      "Okay, let me look. Paystack processes payments across Africa.",
    ];
    for (const input of cases) {
      const result = stripEmptyPromises(input);
      expect(result.text, input).toBe(
        "Paystack processes payments across Africa.",
      );
      expect(result.removed, input).toHaveLength(1);
    }
  });

  it("removes a run of them, not just the first", () => {
    const result = stripEmptyPromises(
      "One second. Let me check that. Revenue grew by a fifth.",
    );
    expect(result.text).toBe("Revenue grew by a fifth.");
    expect(result.removed).toHaveLength(2);
  });

  it("leaves a real sentence that happens to start the same way", () => {
    const kept = [
      "I'll be direct: the numbers do not support that valuation.",
      "Let me put it plainly, the round is oversubscribed.",
      "I will introduce you to two investors whose mandate fits.",
      "One second of downtime costs them about four thousand pounds.",
      "Let me know which of the three you want to open.",
    ];
    for (const input of kept) {
      expect(stripEmptyPromises(input).text, input).toBe(input);
      expect(stripEmptyPromises(input).removed, input).toEqual([]);
    }
  });

  it("leaves a promise that sits inside the answer rather than at either end", () => {
    const input =
      "Their last filing is from 2024. Let me check whether a newer one exists. The register lists two directors.";
    expect(stripEmptyPromises(input).text).toBe(input);
  });

  it("removes a closing promise, which nothing ever follows", () => {
    // Live: an answer ended "Give me a moment to look that up." and the
    // person waited for a lookup that was never going to happen.
    const result = stripEmptyPromises(
      "Funds active in early-stage insurtech include Ventures Platform and TLcom Capital. Give me a moment to look that up.",
    );
    expect(result.text).toBe(
      "Funds active in early-stage insurtech include Ventures Platform and TLcom Capital.",
    );
    expect(result.removed).toEqual(["Give me a moment to look that up."]);
  });

  it("leaves an answer that is nothing but a promise, so the real failure stays visible", () => {
    // Deleting this would turn "Q said it would check and never did" into
    // "Q said nothing at all", which is harder to notice and no better.
    const input = "Let me check that.";
    expect(stripEmptyPromises(input).text).toBe(input);
    expect(stripEmptyPromises(input).removed).toEqual([]);
  });

  it("leaves ordinary prose untouched", () => {
    const input =
      "Paystack is a Nigerian payments company. Stripe acquired it in 2020.";
    expect(stripEmptyPromises(input).text).toBe(input);
  });
});
