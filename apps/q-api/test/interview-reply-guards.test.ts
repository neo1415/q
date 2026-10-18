import { describe, expect, it } from "vitest";

import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";

import { notVerbatim, sameWords } from "../src/voice/interview-agent.js";
import { definitionFor } from "../src/voice/interview-steps.js";
import { onlyOptionNamedIn } from "../src/voice/onboarding-port.js";

/** QA 2026-10-03, onboarding session 345a7155. */

describe("never the previous question word for word", () => {
  const previous = "What stage is the company at?";
  it("acknowledges and asks in its other wording", () => {
    expect(
      notVerbatim("What stage is the company at?", previous, {
        asking: "F1.stage",
        alternate: () => "Which stage best describes the company today?",
      }),
    ).toBe("Noted. Which stage best describes the company today?");
  });
  it("with no other wording, still acknowledges first", () => {
    expect(
      notVerbatim("what stage is the company at", previous, {
        asking: null,
        alternate: () => null,
      }),
    ).toBe("Noted. Coming back to it: what stage is the company at");
  });
  it("a different reply is untouched", () => {
    expect(
      notVerbatim("Singapore! Busy week. What stage are you at?", previous, {
        asking: "F1.stage",
        alternate: () => "x",
      }),
    ).toBe("Singapore! Busy week. What stage are you at?");
    expect(sameWords("A, b!", "a b")).toBe(true);
  });
});

describe("a choice they named themselves is theirs", () => {
  const step = definitionFor("founder").steps.find(
    (candidate) => candidate.stepKey === FOUNDER_STEPS.currency,
  );
  if (step === undefined) throw new Error("no currency step");
  it.each([
    ["110 million US dollars", "usd", true],
    [
      "We want 110 million dollars. No, dollars. 110 million US dollars.",
      "usd",
      true,
    ],
    ["110 million, in naira or dollars, not sure", "usd", false],
    ["110 million", "usd", false],
    ["110 million US dollars", "ngn", false],
  ] as const)("'%s' names %s: %s", (quote, option, expected) => {
    expect(onlyOptionNamedIn("founder", step, option, quote)).toBe(expected);
  });
});
