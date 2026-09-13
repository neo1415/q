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
