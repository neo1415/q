import { describe, expect, it } from "vitest";

import {
  INVESTOR_LIST_THEMES,
  INVESTOR_NONE_STEPS,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
import type { OnboardingState } from "@capital-q/q-tools";

import {
  isWholeNone,
  isWholeSkip,
  listsSettledByAnswer,
  themeAskedIn,
  themeFollowUp,
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
  it("asks the fourteen lists in five questions, none of them twice", () => {
    // Three themes cover twelve lists, each exactly once; the portfolio and
    // the anything-else note are their own words, one question each.
    expect(INVESTOR_LIST_THEMES).toHaveLength(3);
    const themed = INVESTOR_LIST_THEMES.flatMap((theme) => theme.stepKeys);
    expect(new Set(themed).size).toBe(themed.length);
    expect(themed).toHaveLength(12);
    for (const key of themed) expect(INVESTOR_NONE_STEPS.has(key)).toBe(true);
    expect(
      [...INVESTOR_NONE_STEPS].filter((key) => !themed.includes(key)).sort(),
    ).toEqual([I.portfolio, I.additionalContext].sort());
    expect(INVESTOR_NONE_STEPS.size).toBe(14);
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

  it("one list left: the short follow-up after a partial answer, else the list's own question", () => {
    const after = flowFor(
      [
        step(I.founderPreferences),
        step(I.greenFlags, { status: "ANSWERED" }),
        step(I.customCriteria, { status: "ANSWERED" }),
      ],
      I.founderPreferences,
    );
    expect(after.next?.question).toBe(
      "Anything on founding team, or no preference?",
    );
    // Nothing of the theme answered and one list on their path: asked alone.
    const alone = flowFor([step(I.founderPreferences)], I.founderPreferences);
    expect(alone.next?.theme).toBeUndefined();
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

const sorted = (keys: readonly string[]) => [...keys].sort();

describe("only an explicit answer settles a list (unknown stays unknown)", () => {
  const off = INVESTOR_LIST_THEMES.find((t) => t.key === "off_the_table");
  const fit = INVESTOR_LIST_THEMES.find((t) => t.key === "company_fit");
  const all = new Set(INVESTOR_LIST_THEMES.flatMap((t) => t.stepKeys));
  const settle = (over: Partial<Parameters<typeof listsSettledByAnswer>[0]>) =>
    listsSettledByAnswer({
      lastQTurn: null,
      utterance: "",
      recordedThisTurn: [],
      open: all,
      answers: new Map(),
      ...over,
    });

  it("reads a plain none, and a plain skip, as nothing more", () => {
    for (const said of ["None.", "none", "No preference.", "Nothing really"]) {
      expect(isWholeNone(said)).toBe(true);
    }
    for (const said of ["None of the gambling stuff", "No tobacco", "B2B"]) {
      expect(isWholeNone(said)).toBe(false);
    }
    for (const said of ["Skip.", "Not sure", "I don't know"]) {
      expect(isWholeSkip(said)).toBe(true);
    }
    expect(isWholeSkip("Not sure about revenue, B2B though")).toBe(false);
  });

  it("knows which theme Q's last turn asked, by its words", () => {
    expect(themeAskedIn(`Thanks. ${fit?.question ?? ""}`)?.theme.key).toBe(
      "company_fit",
    );
    expect(themeAskedIn("What's your role at the firm?")).toBeUndefined();
  });

  it("'None' to the whole exclusions question settles all four lists", () => {
    expect(
      sorted(settle({ lastQTurn: off?.question, utterance: "None." }).none),
    ).toEqual([...(off?.stepKeys ?? [])].sort());
  });

  it("an answer filling some lists settles nothing else: the rest stay open", () => {
    // Owner: "B2B SaaS, mostly SMEs" says nothing about capital intensity,
    // regulation or revenue; recording None for them is false data.
    const settled = settle({
      lastQTurn: fit?.question,
      utterance: "B2B SaaS, mostly SMEs.",
      recordedThisTurn: [I.businessModels, I.customerTypes],
      open: new Set(
        [...all].filter(
          (key) => key !== I.businessModels && key !== I.customerTypes,
        ),
      ),
    });
    expect(settled).toEqual({ none: [], notKnown: [] });
  });

  it("then asks once, briefly, about just the lists left open", () => {
    const flow = flowFor(
      [
        step(I.businessModels, { status: "ANSWERED" }),
        step(I.customerTypes, { status: "ANSWERED" }),
        step(I.capitalIntensity),
        step(I.regulatoryAppetite),
        step(I.revenueState),
      ],
      I.capitalIntensity,
    );
    expect(flow.next?.question).toBe(
      "Anything on capital intensity, regulated markets or revenue expectations, or no preference?",
    );
    expect(flow.next?.theme?.stepKeys).toEqual([
      I.capitalIntensity,
      I.regulatoryAppetite,
      I.revenueState,
    ]);
    // One list left of a partly answered theme: the same short form.
    expect(themeFollowUp([I.revenueState])).toBe(
      "Anything on revenue expectations, or no preference?",
    );
  });

  it("a plain none to the follow-up is None for just the lists it named", () => {
    const follow = themeFollowUp([I.regulatoryAppetite, I.revenueState]);
    expect(
      sorted(
        settle({
          lastQTurn: `Noted. ${follow}`,
          utterance: "No preference.",
          open: new Set([I.regulatoryAppetite, I.revenueState, I.greenFlags]),
        }).none,
      ),
    ).toEqual([I.regulatoryAppetite, I.revenueState].sort());
  });

  it("a plain skip of the follow-up is not known, never None", () => {
    const follow = themeFollowUp([I.regulatoryAppetite, I.revenueState]);
    expect(
      settle({
        lastQTurn: follow,
        utterance: "Not sure.",
        open: new Set([I.regulatoryAppetite, I.revenueState]),
      }),
    ).toEqual({
      none: [],
      notKnown: [I.regulatoryAppetite, I.revenueState],
    });
    // A skip of the theme's first question is the model's to handle.
    expect(settle({ lastQTurn: fit?.question, utterance: "Skip." })).toEqual({
      none: [],
      notKnown: [],
    });
  });

  it("an answer to something else settles nothing", () => {
    expect(
      settle({ lastQTurn: "What's your typical cheque?", utterance: "None." }),
    ).toEqual({ none: [], notKnown: [] });
  });

  it("'None' to sectors to avoid answers the rest of what they do not want to see", () => {
    expect(
      sorted(
        settle({
          lastQTurn: "Are there any sectors you'd rather not see?",
          utterance: "None.",
          recordedThisTurn: [I.sectorsAvoid],
          open: new Set([I.avoid, I.hardExclusions, I.sectorExclusions]),
          answers: new Map([
            [I.sectorsAvoid, { type: "TEXT", text: "None" } as const],
          ]),
        }).none,
      ),
    ).toEqual([I.avoid, I.hardExclusions, I.sectorExclusions].sort());
  });

  it("never touches a list that already holds their answer", () => {
    expect(
      settle({
        lastQTurn: off?.question,
        utterance: "None.",
        open: new Set([I.avoid]),
      }).none,
    ).toEqual([I.avoid]);
  });
});
