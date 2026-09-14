import { describe, expect, it } from "vitest";

import type { OnboardingStepConfiguration } from "../src/definitions/schema.js";
import {
  parseFigurePair,
  resolveAcrossSteps,
  type CrossStepInput,
  type InterviewCues,
} from "../src/domain/resolution/cross-step.js";

/**
 * One utterance answers many questions (CQ-Q-VOICE-001 A §8-§9, §12): the
 * founder's and the investor's sentences from the packet, read against
 * every step of a small journey, with figures next to cue words, an
 * exclusion mention as a question, and no answer invented for a step the
 * sentence did not touch.
 */

function select(
  stepKey: string,
  options: readonly { optionKey: string; label: string }[],
  status: CrossStepInput["status"] = "UNSEEN",
): CrossStepInput {
  return {
    stepKey,
    status,
    configuration: {
      stepType: "single_select",
      prompt: stepKey,
      options,
    } as unknown as OnboardingStepConfiguration,
  };
}
function multi(
  stepKey: string,
  options: readonly { optionKey: string; label: string }[],
  status: CrossStepInput["status"] = "UNSEEN",
): CrossStepInput {
  return {
    stepKey,
    status,
    configuration: {
      stepType: "multi_select",
      prompt: stepKey,
      options,
      minSelections: 1,
      maxSelections: 5,
      exclusiveOptionKeys: [],
    } as unknown as OnboardingStepConfiguration,
  };
}
function range(stepKey: string, min: string, max: string): CrossStepInput {
  return {
    stepKey,
    status: "UNSEEN",
    configuration: {
      stepType: "range",
      prompt: stepKey,
      min,
      max,
    } as unknown as OnboardingStepConfiguration,
  };
}

const FOUNDER_STEPS: readonly CrossStepInput[] = [
  select("F1.country", [
    { optionKey: "ng", label: "Nigeria" },
    { optionKey: "gh", label: "Ghana" },
    { optionKey: "ke", label: "Kenya" },
  ]),
  select("F1.stage", [
    { optionKey: "seed", label: "Seed" },
    { optionKey: "series_a", label: "Series A" },
  ]),
  select("F4.founder_role", [
    { optionKey: "ceo", label: "CEO" },
    { optionKey: "cto", label: "CTO" },
  ]),
  multi("F6.use_of_funds", [
    { optionKey: "product", label: "Product" },
    { optionKey: "gtm", label: "Sales and marketing" },
    { optionKey: "expansion", label: "New markets" },
  ]),
  range("F6.target_amount", "1", "1000000000000"),
  range("F4.team_size", "1", "100000"),
];
const FOUNDER_ALIASES = {
  "F1.country": {
    ng: ["nigeria", "lagos"],
    gh: ["ghana", "accra"],
    ke: ["kenya", "nairobi"],
  },
  "F4.founder_role": { ceo: ["founder and ceo", "chief executive"] },
  "F6.use_of_funds": {
    gtm: ["sales", "salespeople", "go to market"],
    expansion: ["expand", "expansion", "new markets"],
  },
};
const FOUNDER_CUES: InterviewCues = {
  "F6.target_amount": { kind: "FIGURE", cues: ["raising", "raise", "round"] },
  "F4.team_size": { kind: "FIGURE", cues: ["people", "team of", "employees"] },
};

describe("resolveAcrossSteps · founder", () => {
  const sentence =
    "I'm the founder and CEO. We're based in Lagos, we build software for freight forwarders, and we're raising $1.5m mainly to hire salespeople and expand into Ghana.";

  it("proposes role, country, use of funds and the raise from one sentence, without touching the current step", () => {
    const readings = resolveAcrossSteps({
      text: sentence,
      steps: FOUNDER_STEPS,
      currentStepKey: "F1.description",
      aliases: FOUNDER_ALIASES,
      cues: FOUNDER_CUES,
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "F4.founder_role",
      value: { type: "SINGLE_SELECT", optionKey: "ceo" },
      summary: "CEO",
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "F6.use_of_funds",
      value: { type: "MULTI_SELECT", optionKeys: ["gtm", "expansion"] },
      summary: "Sales and marketing, New markets",
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "F6.target_amount",
      value: { type: "RANGE", value: "1500000" },
      summary: "1500000",
    });
    // Lagos and Ghana both name a country: the person chooses.
    expect(readings).toContainEqual({
      kind: "CHOOSE",
      stepKey: "F1.country",
      options: [
        { optionKey: "ng", label: "Nigeria" },
        { optionKey: "gh", label: "Ghana" },
      ],
    });
    // No stage was said: nothing is invented for it, and no team size either.
    expect(
      readings.some((r) => "stepKey" in r && r.stepKey === "F1.stage"),
    ).toBe(false);
    expect(
      readings.some((r) => "stepKey" in r && r.stepKey === "F4.team_size"),
    ).toBe(false);
  });

  it("skips the step Q is asking and steps already answered", () => {
    const readings = resolveAcrossSteps({
      text: "We're at seed and based in Nigeria.",
      steps: [
        select("F1.stage", [{ optionKey: "seed", label: "Seed" }], "COMPLETED"),
        select("F1.country", [{ optionKey: "ng", label: "Nigeria" }]),
      ],
      currentStepKey: "F1.country",
      aliases: {},
      cues: {},
    });
    expect(readings).toEqual([]);
  });

  it("keeps a figure that has no cue word out of every range step", () => {
    const readings = resolveAcrossSteps({
      text: "We did around $90k MRR last month.",
      steps: FOUNDER_STEPS,
      currentStepKey: null,
      aliases: FOUNDER_ALIASES,
      cues: FOUNDER_CUES,
    });
    expect(readings).toEqual([]);
  });

  it("does not propose a negated option", () => {
    const readings = resolveAcrossSteps({
      text: "We're based in Nigeria, not Kenya.",
      steps: FOUNDER_STEPS,
      currentStepKey: null,
      aliases: FOUNDER_ALIASES,
      cues: FOUNDER_CUES,
    });
    expect(readings).toEqual([
      {
        kind: "PROPOSE",
        stepKey: "F1.country",
        value: { type: "SINGLE_SELECT", optionKey: "ng" },
        summary: "Nigeria",
      },
    ]);
  });
});

const INVESTOR_STEPS: readonly CrossStepInput[] = [
  multi("I2.stages", [
    { optionKey: "pre_seed", label: "Pre-seed" },
    { optionKey: "seed", label: "Seed" },
    { optionKey: "series_a", label: "Series A" },
  ]),
  range("I2.cheque_min", "1", "1000000000"),
  range("I2.cheque_max", "1", "1000000000"),
  range("I2.cheque_typical", "1", "1000000000"),
  multi("I7.avoid", [
    { optionKey: "gambling", label: "Gambling" },
    { optionKey: "hardware_heavy", label: "Hardware-heavy" },
  ]),
  multi("I7.hard_exclusions", [
    { optionKey: "gambling", label: "Gambling" },
    { optionKey: "hardware_heavy", label: "Hardware-heavy" },
  ]),
];
const INVESTOR_ALIASES = {
  "I2.stages": { seed: ["seed"], series_a: ["series a"] },
  "I7.hard_exclusions": { hardware_heavy: ["hardware"] },
};
const INVESTOR_CUES: InterviewCues = {
  "I2.cheque_min": { kind: "FIGURE_RANGE", highStepKey: "I2.cheque_max" },
  "I2.cheque_typical": { kind: "FIGURE", cues: ["typically", "usually"] },
  "I7.hard_exclusions": { kind: "EXCLUSION", softStepKey: "I7.avoid" },
};

describe("resolveAcrossSteps · investor", () => {
  it("proposes stages and the cheque range, and turns exclusions into confirmation questions", () => {
    const readings = resolveAcrossSteps({
      text: "We invest $250k to $1m in Seed and Series A African B2B software. We prefer founders already selling to enterprises. Hardware isn't our thing and we never invest in gambling.",
      steps: INVESTOR_STEPS,
      currentStepKey: "I1.mandate_context",
      aliases: INVESTOR_ALIASES,
      cues: INVESTOR_CUES,
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "I2.stages",
      value: { type: "MULTI_SELECT", optionKeys: ["seed", "series_a"] },
      summary: "Seed, Series A",
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "I2.cheque_min",
      value: { type: "RANGE", value: "250000" },
      summary: "250000",
    });
    expect(readings).toContainEqual({
      kind: "PROPOSE",
      stepKey: "I2.cheque_max",
      value: { type: "RANGE", value: "1000000" },
      summary: "1000000",
    });
    const exclusions = readings.filter((r) => r.kind === "CONFIRM_EXCLUSION");
    expect(
      exclusions.map((r) =>
        r.kind === "CONFIRM_EXCLUSION" ? r.optionKey : "",
      ),
    ).toEqual(["gambling", "hardware_heavy"]);
    // Never a value on the hard-exclusion step, and nothing duplicated on avoid.
    expect(
      readings.some(
        (r) => r.kind === "PROPOSE" && r.stepKey === "I7.hard_exclusions",
      ),
    ).toBe(false);
    expect(
      readings.some((r) => r.kind === "PROPOSE" && r.stepKey === "I7.avoid"),
    ).toBe(false);
  });
});

describe("parseFigurePair", () => {
  it("reads a low and a high figure in either order and with either connector", () => {
    expect(parseFigurePair("$250k to $1m")).toEqual({
      low: "250000",
      high: "1000000",
    });
    expect(parseFigurePair("between 1m and 250k")).toEqual({
      low: "250000",
      high: "1000000",
    });
    expect(parseFigurePair("500k-2m cheques")).toEqual({
      low: "500000",
      high: "2000000",
    });
    expect(parseFigurePair("about $2m")).toBeNull();
  });
});
