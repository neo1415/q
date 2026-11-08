import { describe, expect, it } from "vitest";

import {
  INVESTOR_LIST_THEMES,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";

import {
  listsSettledByAnswer,
  themeFollowUp,
} from "../src/voice/list-settle.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { coverageProfileFor } from "../src/voice/onboarding-port.js";

/**
 * e2e run 5 on production batch 9 (2026-11-08): Q alternated "Are there
 * sectors you'd rather not see?" (answered "None." seven times) and "Which
 * business models do you back?" ("No preference." four times) -- the
 * finishing line's own one-list questions -- and nothing was saved; and it
 * read the cheque back one figure per question. Owner: a plain none to ANY
 * open required list question records None for exactly the lists that
 * question asked; a question is never asked twice after a recordable
 * answer; the cheque is read back as one confirmation for the set.
 */

const I = INVESTOR_STEPS;
const settle = (over: Partial<Parameters<typeof listsSettledByAnswer>[0]>) =>
  listsSettledByAnswer({
    lastQTurn: null,
    utterance: "",
    recordedThisTurn: [],
    open: new Set(INVESTOR_LIST_THEMES.flatMap((t) => t.stepKeys)),
    answers: new Map(),
    ...over,
  });

describe("a plain none to a one-list question (e2e run 5)", () => {
  it("'None.' to the finishing line's business-models question is None for that list only", () => {
    expect(
      settle({
        lastQTurn:
          "Before I can finish, I still need 6 more answers from you, starting with this one. Which business models do you back?",
        askedStep: I.businessModels,
        utterance: "No preference.",
      }),
    ).toEqual({ none: [I.businessModels], notKnown: [] });
  });

  it("'None.' to sectors you'd rather not see is None for what they do not want to see", () => {
    expect(
      [
        ...settle({
          lastQTurn: "Are there sectors you'd rather not see?",
          askedStep: I.sectorsAvoid,
          utterance: "None.",
        }).none,
      ].sort(),
    ).toEqual(
      [I.sectorsAvoid, I.avoid, I.hardExclusions, I.sectorExclusions].sort(),
    );
  });

  it("a plain none to a step that is not a list settles nothing", () => {
    expect(
      settle({
        lastQTurn: "What's your typical cheque?",
        askedStep: I.chequeTypical,
        utterance: "None.",
      }),
    ).toEqual({ none: [], notKnown: [] });
  });

  it("an answer with content to a one-list question is the reading's, not code's", () => {
    expect(
      settle({
        lastQTurn: "Which business models do you back?",
        askedStep: I.businessModels,
        utterance: "Subscription software, mostly.",
      }),
    ).toEqual({ none: [], notKnown: [] });
  });

  it("the theme follow-up still names only its own lists", () => {
    expect(
      settle({
        lastQTurn: themeFollowUp([I.revenueState]),
        askedStep: I.revenueState,
        utterance: "None.",
      }).none,
    ).toEqual([I.revenueState]);
  });
});

describe("the cheque is read back once, as a set (DECISIONS 78)", () => {
  const labelOf = (key: string) =>
    coverageProfileFor("investor").fields[key]?.label;
  const held: Readonly<Record<string, string>> = {
    [I.chequeMin]: "$250,000",
    [I.chequeTypical]: "$500,000",
    [I.chequeMax]: "$1 million",
  };
  const missing = [I.chequeMin, I.chequeTypical, I.chequeMax].map(
    (stepKey) => ({ stepKey, question: `Question ${stepKey}?` }),
  );

  it("puts every held figure to them in one line, for one yes", () => {
    const said = finishingLine(
      "investor",
      { completed: false, missing },
      {
        labelOf,
        questionOf: () => null,
        heldFor: (key) => held[key] ?? null,
      },
    );
    const reply = said?.reply ?? "";
    expect(reply).toContain("$250,000");
    expect(reply).toContain("$500,000");
    expect(reply).toContain("$1 million");
    expect(reply.match(/Shall I keep/gu) ?? []).toHaveLength(1);
    expect(reply).toMatch(/Shall I keep these\?/u);
    expect(said?.asking).toBe(I.chequeMin);
  });

  it("one held figure is still put on its own", () => {
    const said = finishingLine(
      "investor",
      { completed: false, missing: missing.slice(0, 1) },
      {
        labelOf,
        questionOf: () => null,
        heldFor: (key) => held[key] ?? null,
      },
    );
    expect(said?.reply).toMatch(/Shall I keep that\?/u);
  });
});

describe("the finishing line asks missing lists by theme (e2e run 5)", () => {
  const ask = (keys: readonly string[]) =>
    finishingLine(
      "investor",
      {
        completed: false,
        missing: keys.map((stepKey) => ({
          stepKey,
          question: `Question ${stepKey}?`,
        })),
      },
      { labelOf: () => undefined, questionOf: () => null },
    );

  it("the whole theme missing: its own question, once", () => {
    const off = INVESTOR_LIST_THEMES.find((t) => t.key === "off_the_table");
    const said = ask(off?.stepKeys ?? []);
    expect(said?.reply).toContain(off?.question ?? "missing");
  });

  it("some of a theme missing: the short follow-up naming just those", () => {
    const said = ask([I.businessModels, I.revenueState, I.portfolio]);
    expect(said?.reply).toContain(
      "Anything on business models or revenue expectations, or no preference?",
    );
    expect(said?.asking).toBe(I.businessModels);
  });

  it("one list of a theme missing: its own question", () => {
    const said = ask([I.portfolio]);
    expect(said?.reply).toContain(`Question ${I.portfolio}?`);
  });
});

describe("the natural nones (e2e run 7)", () => {
  it("are plain nones; not sure and skip are not", async () => {
    const { isWholeNone, isWholeSkip } =
      await import("../src/voice/list-settle.js");
    for (const said of [
      "No, that's everything.",
      "Nothing else.",
      "That's all.",
      "None yet.",
      "Not yet.",
      "No portfolio yet.",
      "Nothing to add.",
    ]) {
      expect(isWholeNone(said)).toBe(true);
    }
    for (const said of ["Not sure.", "Skip.", "I don't know."]) {
      expect(isWholeNone(said)).toBe(false);
      expect(isWholeSkip(said)).toBe(true);
    }
    // Still a finishing word, never a none, when it carries more.
    expect(isWholeNone("Yes, that's right. That's all for now.")).toBe(false);
  });
});
