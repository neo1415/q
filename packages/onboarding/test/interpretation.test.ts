import { describe, expect, it } from "vitest";

import type { OnboardingStepPresentation } from "@capital-q/contracts";

import {
  interpretUtterance,
  parseFigure,
} from "../src/domain/interpretation.js";

/**
 * CQ-PRE-REC-001 §17-§19: the conversational interview places what a
 * person says deterministically where the definition already knows how
 * to hold it, and hands everything else to Q's reading. No model, no
 * guessing.
 */

const STAGES: OnboardingStepPresentation = {
  stepType: "single_select",
  options: [
    { optionKey: "pre_seed", label: "Pre-seed" },
    { optionKey: "seed", label: "Seed" },
    { optionKey: "series_a", label: "Series A" },
    { optionKey: "unsure", label: "Not sure yet" },
  ],
};

const step = (
  presentation: OnboardingStepPresentation,
  required = true,
  stepKey = "F1.stage",
) => ({ stepKey, required, presentation });

const ALIASES = { "F1.stage": { seed: ["seed round"], series_a: ["a round"] } };

describe("interpretUtterance · single select", () => {
  it("answers with the one option a sentence names", () => {
    const reading = interpretUtterance("We're at seed", step(STAGES), ALIASES);
    expect(reading).toEqual({
      kind: "ANSWER",
      value: { type: "SINGLE_SELECT", optionKey: "seed" },
      summary: "Seed",
    });
  });

  it("accepts an exact label regardless of case and punctuation", () => {
    expect(interpretUtterance("series a.", step(STAGES))).toMatchObject({
      kind: "ANSWER",
      value: { optionKey: "series_a" },
    });
  });

  it("never reads a short option code as a word", () => {
    const countries: OnboardingStepPresentation = {
      stepType: "single_select",
      options: [
        { optionKey: "ng", label: "Nigeria" },
        { optionKey: "in", label: "India" },
        { optionKey: "us", label: "United States" },
      ],
    };
    expect(
      interpretUtterance("We are based in Lagos", step(countries), {
        "F1.stage": { ng: ["lagos"] },
      }),
    ).toMatchObject({ kind: "ANSWER", value: { optionKey: "ng" } });
  });

  it("hands back the choice when two options fit", () => {
    expect(
      interpretUtterance("somewhere between seed and series A", step(STAGES)),
    ).toEqual({ kind: "AMBIGUOUS", optionKeys: ["seed", "series_a"] });
  });

  it("makes a definition's own 'not sure' the answer to I don't know", () => {
    expect(interpretUtterance("I don't know", step(STAGES))).toMatchObject({
      kind: "ANSWER",
      value: { optionKey: "unsure" },
    });
  });

  it("sends a rich sentence that names no option to Q's reading", () => {
    expect(
      interpretUtterance(
        "We closed a small round from angels last year and are now talking to funds",
        step(STAGES),
      ),
    ).toEqual({ kind: "NARRATIVE" });
  });

  it("says so when a short reply matches nothing", () => {
    expect(interpretUtterance("blue", step(STAGES))).toEqual({
      kind: "UNCLEAR",
    });
  });
});

describe("interpretUtterance · conversational moves", () => {
  it("recognises skip, why and upload", () => {
    expect(interpretUtterance("skip", step(STAGES))).toEqual({ kind: "SKIP" });
    expect(interpretUtterance("come back to this later", step(STAGES))).toEqual(
      {
        kind: "SKIP",
      },
    );
    expect(interpretUtterance("Why do you need this?", step(STAGES))).toEqual({
      kind: "WHY",
    });
    expect(
      interpretUtterance("let me upload my deck instead", step(STAGES)),
    ).toEqual({ kind: "UPLOAD" });
  });

  it("treats I don't know as a skip when the definition offers no such option", () => {
    const withoutUnsure: OnboardingStepPresentation = {
      stepType: "single_select",
      options: STAGES.options.slice(0, 3),
    };
    expect(interpretUtterance("not sure", step(withoutUnsure))).toEqual({
      kind: "SKIP",
    });
  });
});

describe("interpretUtterance · other step types", () => {
  it("collects every named option of a multi select, bounded by the definition", () => {
    const functions: OnboardingStepPresentation = {
      stepType: "multi_select",
      options: [
        { optionKey: "product", label: "Product" },
        { optionKey: "engineering", label: "Engineering" },
        { optionKey: "sales", label: "Sales and partnerships" },
      ],
      minSelections: 1,
      maxSelections: 3,
      exclusiveOptionKeys: [],
    };
    expect(
      interpretUtterance("product and engineering", step(functions)),
    ).toMatchObject({
      kind: "ANSWER",
      value: { type: "MULTI_SELECT", optionKeys: ["product", "engineering"] },
    });
  });

  it("reads a figure inside the range, in the person's shorthand", () => {
    const amount: OnboardingStepPresentation = {
      stepType: "range",
      min: "1",
      max: "1000000000000",
    };
    expect(interpretUtterance("$3m", step(amount))).toEqual({
      kind: "ANSWER",
      value: { type: "RANGE", value: "3000000" },
      summary: "3000000",
    });
    expect(interpretUtterance("about 250k", step(amount))).toMatchObject({
      value: { value: "250000" },
    });
  });

  it("does not turn a sentence with a figure into a bare number", () => {
    const amount: OnboardingStepPresentation = {
      stepType: "range",
      min: "1",
      max: "1000000000000",
    };
    expect(
      interpretUtterance(
        "We did about $1.8m ARR last year and we're raising $3m mostly for US expansion",
        step(amount),
      ),
    ).toEqual({ kind: "NARRATIVE" });
  });

  it("takes a plain answer for a text step and a yes for a confirmation", () => {
    const name: OnboardingStepPresentation = {
      stepType: "short_text",
      minLength: 1,
      maxLength: 120,
    };
    expect(interpretUtterance("Northstar Logistics", step(name))).toMatchObject(
      {
        kind: "ANSWER",
        value: { type: "TEXT", text: "Northstar Logistics" },
      },
    );
    const confirm: OnboardingStepPresentation = {
      stepType: "confirmation",
      confirmLabel: "Looks right",
      requireAffirmative: true,
    };
    expect(interpretUtterance("yes, looks right", step(confirm))).toEqual({
      kind: "UNCLEAR",
    });
    expect(interpretUtterance("Looks right", step(confirm))).toMatchObject({
      kind: "ANSWER",
      value: { type: "CONFIRMATION", confirmed: true },
    });
    expect(interpretUtterance("not quite", step(confirm))).toEqual({
      kind: "DECLINE",
    });
  });
});

describe("parseFigure", () => {
  it("reads currency symbols, separators and suffixes", () => {
    expect(parseFigure("$1.8m")).toBe("1800000");
    expect(parseFigure("£250k")).toBe("250000");
    expect(parseFigure("1,000")).toBe("1000");
    expect(parseFigure("3")).toBe("3");
    expect(parseFigure("none")).toBeNull();
  });
});

describe("interpretUtterance · negation and confirmation labels (CQ-PRE-REC-001 §43)", () => {
  const signal: OnboardingStepPresentation = {
    stepType: "single_select",
    options: [
      { optionKey: "pilots", label: "Pilots running" },
      { optionKey: "lois", label: "Signed letters of intent" },
      { optionKey: "waitlist", label: "A waitlist" },
      { optionKey: "none", label: "Nothing measurable yet" },
    ],
  };
  const step = { stepKey: "F5.signal", required: true, presentation: signal };
  const aliases = {
    "F5.signal": { pilots: ["pilots", "pilot"], waitlist: ["waitlist"] },
  };

  it("does not read a negated mention as the answer; a rich sentence goes to Q instead", () => {
    expect(
      interpretUtterance(
        "We already have 40 paying clinics, so beyond pilots",
        step,
        aliases,
      ),
    ).toEqual({ kind: "NARRATIVE" });
    expect(
      interpretUtterance("not a waitlist, pilots", step, aliases),
    ).toMatchObject({
      kind: "ANSWER",
      value: { optionKey: "pilots" },
    });
    // A plain mention still answers.
    expect(
      interpretUtterance("two pilots running", step, aliases),
    ).toMatchObject({
      kind: "ANSWER",
      value: { optionKey: "pilots" },
    });
  });

  it("does not read a word inside another matched option's phrase as a second answer", () => {
    const roles: OnboardingStepPresentation = {
      stepType: "multi_select",
      options: [
        { optionKey: "lead", label: "Lead rounds" },
        { optionKey: "co_invest", label: "Co-invest alongside a lead" },
        { optionKey: "follow", label: "Follow in later rounds" },
      ],
      minSelections: 1,
      maxSelections: 3,
      exclusiveOptionKeys: [],
    };
    const role = {
      stepKey: "I2.investment_role",
      required: false,
      presentation: roles,
    };
    const roleAliases = {
      "I2.investment_role": {
        lead: ["lead", "we lead"],
        co_invest: ["co-invest", "co invest"],
      },
    };
    expect(
      interpretUtterance("We co-invest alongside a lead", role, roleAliases),
    ).toMatchObject({ kind: "ANSWER", value: { optionKeys: ["co_invest"] } });
    expect(interpretUtterance("we lead", role, roleAliases)).toMatchObject({
      kind: "ANSWER",
      value: { optionKeys: ["lead"] },
    });
    expect(
      interpretUtterance("we lead and we co-invest", role, roleAliases),
    ).toMatchObject({
      kind: "ANSWER",
      value: { optionKeys: ["lead", "co_invest"] },
    });
  });

  it("accepts a confirmation step's own labels as the answer", () => {
    const confirm: OnboardingStepPresentation = {
      stepType: "confirmation",
      confirmLabel: "Save my raise",
      requireAffirmative: true,
      declineLabel: "Not yet",
      contextKey: "founder.raise",
    };
    const raise = {
      stepKey: "F6.confirm",
      required: true,
      presentation: confirm,
    };
    expect(interpretUtterance("Save my raise", raise)).toEqual({
      kind: "ANSWER",
      value: { type: "CONFIRMATION", confirmed: true },
      summary: "Save my raise",
    });
    expect(interpretUtterance("Not yet", raise)).toEqual({ kind: "DECLINE" });
    expect(interpretUtterance("Save it please", raise)).toEqual({
      kind: "UNCLEAR",
    });
  });
});

describe("interpretUtterance · reference steps with candidates (CQ-PRE-REC-001 §38)", () => {
  const mandates: OnboardingStepPresentation = {
    stepType: "reference_select",
    resourceType: "INVESTOR_MANDATE",
    vocabularyCodes: [],
    minItems: 1,
    maxItems: 1,
    contextKey: "investor.mandates",
  };
  const withCandidates = (
    candidates: readonly { mandateId: string; name: string }[],
  ) => ({
    stepKey: "I1.mandate_context",
    required: true,
    presentation: mandates,
    context: { kind: "investor.mandates", candidates },
  });

  it("answers a single candidate on plain assent, and a named one by name", () => {
    const one = withCandidates([{ mandateId: "m-1", name: "Primary mandate" }]);
    expect(interpretUtterance("yes", one)).toEqual({
      kind: "ANSWER",
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "INVESTOR_MANDATE",
        resourceIds: ["m-1"],
      },
      summary: "Primary mandate",
    });
    const two = withCandidates([
      { mandateId: "m-1", name: "Primary mandate" },
      { mandateId: "m-2", name: "Growth fund II" },
    ]);
    expect(interpretUtterance("the growth fund", two)).toMatchObject({
      kind: "ANSWER",
      value: { resourceIds: ["m-2"] },
    });
    // Assent alone cannot pick between two.
    expect(interpretUtterance("yes", two)).toEqual({ kind: "UNCLEAR" });
  });

  it("never invents a candidate", () => {
    expect(
      interpretUtterance("yes", { ...withCandidates([]), context: undefined }),
    ).toEqual({ kind: "UNCLEAR" });
  });
});
