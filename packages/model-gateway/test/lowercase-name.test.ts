import { describe, expect, it } from "vitest";

import { lowercaseNameCandidates } from "../src/q/named-company-fact.js";

/**
 * Turn latency round 5: a company typed in lowercase is looked up by code,
 * as a capitalised one is, so the model does not spend a round searching.
 * A candidate is only a search term; an exact visible match is required.
 */
describe("lowercase company names", () => {
  it.each([
    ["what are the risks with northwind ledger?", ["northwind ledger"]],
    ["tell me about the halyard health deal", ["halyard health"]],
    [
      "compare northwind ledger and halyard health",
      ["northwind ledger", "halyard health"],
    ],
    ["what stage is kazikit at", ["kazikit"]],
    ["what does ledgerfold do", ["ledgerfold"]],
  ] as const)("%s", (said, expected) => {
    expect(lowercaseNameCandidates(said)).toEqual(expected);
  });

  it.each([
    "what should i focus on today?",
    "tell me about it",
    "what about my mandate?",
    "anything new with my companies",
    "thanks, that's great",
  ])("finds no name in %s", (said) => {
    expect(lowercaseNameCandidates(said)).toEqual([]);
  });

  it("leaves a capitalised name to the capitalised reader", () => {
    expect(lowercaseNameCandidates("risks with Northwind Ledger")).toEqual([]);
  });
});
