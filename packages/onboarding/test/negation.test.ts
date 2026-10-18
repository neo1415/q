import { describe, expect, it } from "vitest";

import type { OnboardingStepPresentation } from "@capital-q/contracts";

import { interpretUtterance } from "../src/domain/interpretation.js";
import {
  affirmativeText,
  affirmedMention,
  clausesOf,
  negatedMention,
} from "../src/domain/negation.js";
import { matchedOptions } from "../src/domain/resolution/options.js";

/**
 * Negation, contrast and scope (CQ-Q-VOICE-001 A §7): the four sentences
 * the packet names must not read alike, and a mention that only lives
 * after a negation marker in its clause is never an answer.
 */

const SECTORS: OnboardingStepPresentation = {
  stepType: "multi_select",
  options: [
    { optionKey: "fintech", label: "Fintech" },
    { optionKey: "logistics", label: "Logistics" },
    { optionKey: "health", label: "Health" },
  ],
  minSelections: 1,
  maxSelections: 3,
  exclusiveOptionKeys: [],
};
const ALIASES = {
  logistics: ["logistics infrastructure", "logistics software"],
};

describe("affirmativeText and clauses", () => {
  it("splits on punctuation, commas and contrast words", () => {
    expect(clausesOf("We do payments, not lending; but never crypto.")).toEqual(
      ["We do payments", "not lending", "never crypto"],
    );
  });

  it("keeps what comes before a marker and drops what follows it, clause by clause", () => {
    expect(affirmativeText("We do fintech.")).toBe("we do fintech");
    expect(affirmativeText("We don't do fintech.")).toBe("we");
    expect(
      affirmativeText(
        "We're not really fintech — we're logistics infrastructure.",
      ),
    ).toBe("we're , we're logistics infrastructure");
    expect(
      affirmativeText("Unlike fintech companies, we build logistics software."),
    ).toBe("we build logistics software");
    expect(affirmativeText("Nigeria and Ghana, but not Kenya.")).toBe(
      "nigeria and ghana",
    );
  });
});

describe("negatedMention / affirmedMention", () => {
  it("tells the four sentences apart", () => {
    expect(affirmedMention("We do fintech.", "fintech")).toBe(true);
    expect(negatedMention("We do fintech.", "fintech")).toBe(false);

    expect(negatedMention("We don't do fintech.", "fintech")).toBe(true);
    expect(affirmedMention("We don't do fintech.", "fintech")).toBe(false);

    const contrast =
      "We're not really fintech — we're logistics infrastructure.";
    expect(negatedMention(contrast, "fintech")).toBe(true);
    expect(affirmedMention(contrast, "logistics infrastructure")).toBe(true);

    const unlike = "Unlike fintech companies, we build logistics software.";
    expect(negatedMention(unlike, "fintech")).toBe(true);
    expect(affirmedMention(unlike, "logistics software")).toBe(true);
  });

  it("scopes a marker to its clause: a country named before 'but not' stays affirmed", () => {
    const text = "We operate in Nigeria and Ghana, but not Kenya.";
    expect(affirmedMention(text, "nigeria")).toBe(true);
    expect(affirmedMention(text, "ghana")).toBe(true);
    expect(negatedMention(text, "kenya")).toBe(true);
  });

  it("a phrase said both ways is affirmed, not negated", () => {
    const text = "Not just fintech: fintech and health.";
    expect(negatedMention(text, "fintech")).toBe(false);
    expect(affirmedMention(text, "health")).toBe(true);
  });
});

describe("option resolution under negation", () => {
  it("never selects a negated option, and selects the contrasted one", () => {
    const options = SECTORS.stepType === "multi_select" ? SECTORS.options : [];
    expect(matchedOptions("We don't do fintech.", options, ALIASES)).toEqual(
      [],
    );
    expect(
      matchedOptions(
        "We're not really fintech — we're logistics infrastructure.",
        options,
        ALIASES,
      ).map((o) => o.optionKey),
    ).toEqual(["logistics"]);
    expect(
      matchedOptions(
        "Unlike fintech companies, we build logistics software.",
        options,
        ALIASES,
      ).map((o) => o.optionKey),
    ).toEqual(["logistics"]);
    expect(
      matchedOptions("We do fintech.", options, ALIASES).map(
        (o) => o.optionKey,
      ),
    ).toEqual(["fintech"]);
  });

  it("reads through interpretUtterance the same way", () => {
    expect(
      interpretUtterance("We're not fintech, we do health.", {
        stepKey: "sectors",
        required: true,
        presentation: SECTORS,
      }),
    ).toMatchObject({
      kind: "ANSWER",
      value: { type: "MULTI_SELECT", optionKeys: ["health"] },
    });
  });
});
