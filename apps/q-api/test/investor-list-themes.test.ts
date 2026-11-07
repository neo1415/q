import { describe, expect, it } from "vitest";

import {
  INVESTOR_LIST_THEMES,
  INVESTOR_NONE_STEPS,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
import type { OnboardingState } from "@capital-q/q-tools";

import {
  isWholeNone,
  listsSettledByAnswer,
  themeAskedIn,
} from "../src/voice/list-settle.js";
import {
  onboardingFlowFor,
  withNextQuestion,
} from "../src/voice/onboarding-flow.js";

/**
 * e2e run 4 on production batch 8 (2026-11-07): Q asked the investor's
 * lists one at a time -- sectors to avoid, business models and customer
 * types, capital intensity and regulation, revenue, founders, green flags,
 * anything else, then the exclusions three times. Owner: "ask the lists
 * in as few natural questions as possible; never a 10-question form", and
 * never re-ask a concept already answered.
 */

const I = INVESTOR_STEPS;

const step = (
  stepKey: string,
  over: Partial<OnboardingState["steps"][number]> = {},
): OnboardingState["steps"][number] => ({
  stepKey,
  question: `Question ${stepKey}?`,
  kind: "TEXT",
  required: true,
  status: "OPEN",
  value: null,
  ...over,
});

const investorState = (
  steps: OnboardingState["steps"],
  next: OnboardingState["next"],
): OnboardingState => ({
  journey: "investor",
  currentStepKey: null,
  canComplete: false,
  completed: false,
  steps,
  checks: [],
  next,
  minutesLeft: 6,
});

const flowFor = (
  steps: OnboardingState["steps"],
  nextKey: string,
  journey: "investor" | "founder" = "investor",
) =>
  onboardingFlowFor({
    journey,
    opening: false,
    state: investorState(steps, [
      { stepKey: nextKey, reason: "IMPORTANT_MISSING" },
    ]),
    firstName: null,
    knownName: null,
  });

describe("the investor's lists, by theme", () => {
  it("covers every list None answers in exactly one theme, at most three questions", () => {
    expect(INVESTOR_LIST_THEMES.length).toBeLessThanOrEqual(3);
    const themed = INVESTOR_LIST_THEMES.flatMap((theme) => theme.stepKeys);
    expect(new Set(themed).size).toBe(themed.length);
    for (const key of themed) expect(INVESTOR_NONE_STEPS.has(key)).toBe(true);
    for (const key of [
      I.sectorsAvoid,
      I.businessModels,
      I.customerTypes,
      I.capitalIntensity,
      I.regulatoryAppetite,
      I.revenueState,
      I.founderPreferences,
      I.greenFlags,
      I.customCriteria,
      I.avoid,
      I.hardExclusions,
      I.sectorExclusions,
    ]) {
      expect(themed).toContain(key);
    }
  });

  it("asks a list's whole theme as one question, never the list alone", () => {
    const fit = INVESTOR_LIST_THEMES.find((t) => t.key === "company_fit");
    const flow = flowFor(
      (fit?.stepKeys ?? []).map((key) => step(key)),
      I.businessModels,
    );
    expect(flow.next?.question).toBe(fit?.question);
    expect(flow.next?.theme?.stepKeys).toEqual(fit?.stepKeys);
    expect(flow.note).toContain(fit?.question ?? "missing");
    expect(flow.note).toMatch(/never ask them one by one/u);
    // The backstop asks the theme too.
    expect(withNextQuestion("Saved.", flow, false)).toBe(
      `Saved. ${fit?.question ?? ""}`,
    );
  });

  it("the exclusions are one question: sectors to avoid opens the whole theme", () => {
    const off = INVESTOR_LIST_THEMES.find((t) => t.key === "off_the_table");
    const flow = flowFor(
      (off?.stepKeys ?? []).map((key) => step(key)),
      I.sectorsAvoid,
    );
    expect(flow.next?.question).toBe(off?.question);
  });

  it("a theme with one list left asks that list on its own", () => {
    const flow = flowFor(
      [
        step(I.founderPreferences),
        step(I.greenFlags, { status: "ANSWERED" }),
        step(I.customCriteria, { status: "ANSWERED" }),
      ],
      I.founderPreferences,
    );
    expect(flow.next?.theme).toBeUndefined();
    expect(flow.next?.question).not.toBe(
      INVESTOR_LIST_THEMES.find((t) => t.key === "what_you_look_for")?.question,
    );
  });

  it("founders are never asked an investor theme", () => {
    const flow = flowFor(
      [step(I.businessModels), step(I.customerTypes)],
      I.businessModels,
      "founder",
    );
    expect(flow.next?.theme).toBeUndefined();
  });
});

describe("one answer settles the theme it answers", () => {
  const off = INVESTOR_LIST_THEMES.find((t) => t.key === "off_the_table");
  const fit = INVESTOR_LIST_THEMES.find((t) => t.key === "company_fit");
  const all = new Set(INVESTOR_LIST_THEMES.flatMap((t) => t.stepKeys));

  it("reads a plain none as none, and nothing more", () => {
    for (const said of ["None.", "none", "No preference.", "Nothing really"]) {
      expect(isWholeNone(said)).toBe(true);
    }
    for (const said of ["None of the gambling stuff", "No tobacco", "B2B"]) {
      expect(isWholeNone(said)).toBe(false);
    }
  });

  it("knows which theme Q's last turn asked, by its words", () => {
    expect(themeAskedIn(`Thanks. ${fit?.question ?? ""}`)?.key).toBe(
      "company_fit",
    );
    expect(themeAskedIn("What's your role at the firm?")).toBeUndefined();
  });

  it("'None' to the exclusions question settles all four lists", () => {
    expect(
      listsSettledByAnswer({
        lastQTurn: off?.question,
        utterance: "None.",
        recordedThisTurn: [],
        open: all,
        answers: new Map(),
      }).sort(),
    ).toEqual([...(off?.stepKeys ?? [])].sort());
  });

  it("an answer filling some lists settles the rest of that theme only", () => {
    const settled = listsSettledByAnswer({
      lastQTurn: fit?.question,
      utterance: "B2B SaaS with some revenue.",
      recordedThisTurn: [I.businessModels, I.revenueState],
      open: new Set(
        [...all].filter(
          (key) => key !== I.businessModels && key !== I.revenueState,
        ),
      ),
      answers: new Map(),
    });
    expect(settled.sort()).toEqual(
      [I.customerTypes, I.capitalIntensity, I.regulatoryAppetite].sort(),
    );
  });

  it("an answer to something else settles nothing", () => {
    expect(
      listsSettledByAnswer({
        lastQTurn: "What's your typical cheque?",
        utterance: "None.",
        recordedThisTurn: [],
        open: all,
        answers: new Map(),
      }),
    ).toEqual([]);
  });

  it("'None' to sectors to avoid answers the rest of what they do not want to see", () => {
    expect(
      listsSettledByAnswer({
        lastQTurn: "Are there any sectors you'd rather not see?",
        utterance: "None.",
        recordedThisTurn: [I.sectorsAvoid],
        open: new Set([I.avoid, I.hardExclusions, I.sectorExclusions]),
        answers: new Map([
          [I.sectorsAvoid, { type: "TEXT", text: "None" } as const],
        ]),
      }).sort(),
    ).toEqual([I.avoid, I.hardExclusions, I.sectorExclusions].sort());
  });

  it("never touches a list that already holds their answer", () => {
    expect(
      listsSettledByAnswer({
        lastQTurn: off?.question,
        utterance: "None.",
        recordedThisTurn: [],
        open: new Set([I.avoid]),
        answers: new Map(),
      }),
    ).toEqual([I.avoid]);
  });
});
