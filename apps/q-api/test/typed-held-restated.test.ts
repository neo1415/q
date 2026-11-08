import { describe, expect, it } from "vitest";

import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";

import { heldOfferedIn, restatedHeld } from "../src/voice/typed-onboarding.js";

/**
 * Production run 5 (00:59:24 to 01:05:55): the cheque sat held for their
 * yes and was never saved; every reply to the read-back restated the
 * range, and none counted. A reply that says the very values Q read back
 * agrees to them; one yes accepts the set Q read back together.
 */
const I = INVESTOR_STEPS;
const HELD = [
  { stepKey: I.chequeMin, value: "$250,000" },
  { stepKey: I.chequeTypical, value: "$500,000" },
  { stepKey: I.chequeMax, value: "$1 million" },
];
const READ_BACK =
  "Before I can finish, I need your yes on these. From what you said:\n\nMinimum cheque: $250,000\nTypical cheque: $500,000\nMaximum cheque: $1 million\n\nShall I keep these? Say yes, or tell me what to change.";

describe("the held set Q read back", () => {
  it("is every held value that line read back, the asked one first", () => {
    expect(
      heldOfferedIn(HELD, I.chequeMin, READ_BACK).map((item) => item.stepKey),
    ).toEqual([I.chequeMin, I.chequeTypical, I.chequeMax]);
  });

  it("is only the asked one when the line read back nothing else", () => {
    expect(
      heldOfferedIn(
        HELD,
        I.chequeMin,
        "From what you said: Minimum cheque: $250,000. Shall I keep that?",
      ).map((item) => item.stepKey),
    ).toEqual([I.chequeMin]);
  });
});

describe("restating the held values is a yes to them", () => {
  it("the range said back in other words agrees to all three", () => {
    expect(
      restatedHeld(
        HELD,
        "Minimum $250,000, typical $500,000, maximum $1,000,000.",
      ).sort(),
    ).toEqual([I.chequeMin, I.chequeTypical, I.chequeMax].sort());
    expect(restatedHeld(HELD, "250k, 500k and 1m")).toHaveLength(3);
  });

  it("a different figure is never a yes", () => {
    expect(
      restatedHeld(HELD, "Minimum $100,000, typical $500,000, maximum $1m."),
    ).toEqual([]);
    expect(restatedHeld(HELD, "Just $250,000.")).toEqual([]);
  });

  it("words without figures agree only when they contain the held words", () => {
    const inbound = [
      { stepKey: I.inboundPreference, value: "Only well-matched founders" },
    ];
    expect(
      restatedHeld(inbound, "Only well-matched founders, please."),
    ).toEqual([I.inboundPreference]);
    expect(restatedHeld(inbound, "Anyone can reach out.")).toEqual([]);
  });
});
