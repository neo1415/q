import { describe, expect, it } from "vitest";

import { founderStatedFacts } from "../src/index.js";

/**
 * QA QO-38/44: what a founder told Q in setup, read from their answers so
 * readiness, call prep and the profile stop calling it absent.
 */
describe("a founder's stated facts", () => {
  it("reads the raise, customers and pilots they gave, in the record's shape", () => {
    expect(
      founderStatedFacts({
        "F6.target_amount": { type: "RANGE", value: "1500000" },
        "F6.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
        "F6.instrument": { type: "SINGLE_SELECT", optionKey: "safe" },
        "F6.use_of_funds": { type: "MULTI_SELECT", optionKeys: ["hiring"] },
        "F5.customers": { type: "RANGE", value: "320" },
      }),
    ).toEqual({
      raise: {
        target: "1500000 USD",
        amount: "1500000",
        currency: "USD",
        instrument: "SAFE",
        useOfFunds: true,
      },
      customers: "320",
      pilots: null,
    });
  });

  it("leaves what they did not say unknown, never zero", () => {
    expect(founderStatedFacts({})).toEqual({
      raise: null,
      customers: null,
      pilots: null,
    });
    // A currency with no amount is not a raise.
    expect(
      founderStatedFacts({
        "F6.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
      }).raise,
    ).toBeNull();
  });
});
