import {
  INVESTOR_LIST_THEMES,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
import { OnboardingStateSchema } from "@capital-q/q-tools";
import { describe, expect, it } from "vitest";

import { definitionFor, optionsOf } from "../src/voice/interview-steps.js";
import {
  isWholeNone,
  isWholeSkip,
  listsSettledByAnswer,
  themeFollowUp,
} from "../src/voice/list-settle.js";
import { alreadyPickedUp } from "../src/voice/onboarding-conductor.js";
import {
  confirmTapped,
  followUpIfAnswered,
  settleFinishingAnswer,
} from "../src/voice/typed-onboarding.js";

/**
 * Live investor onboarding on 84ac9afa7, 15 Nov 2026
 * (docs/ai-handoff/audits/2026-11-15-investor-onboarding-live.md; the
 * words below are run-log.jsonl's). No live model: code paths only.
 */
const I = INVESTOR_STEPS;
const theme = (key: string) => {
  const found = INVESTOR_LIST_THEMES.find((t) => t.key === key);
  if (found === undefined) throw new Error(key);
  return found;
};
const allLists = new Set(
  INVESTOR_LIST_THEMES.flatMap((t) => t.stepKeys).concat([I.portfolio]),
);
const settle = (over: Partial<Parameters<typeof listsSettledByAnswer>[0]>) =>
  listsSettledByAnswer({
    lastQTurn: null,
    utterance: "",
    recordedThisTurn: [],
    open: allLists,
    answers: new Map(),
    ...over,
  });

describe("D1: a skip or a none on a needed step is taken, never re-asked", () => {
  it("'None yet, it's a new fund.' is a whole none; a none with content is not", () => {
    expect(isWholeNone("None yet, it's a new fund.")).toBe(true);
    expect(isWholeNone("Not yet, we're just starting.")).toBe(true);
    expect(isWholeNone("No, we invest in fintech.")).toBe(false);
    expect(isWholeNone("None yet, but fintech soon.")).toBe(false);
    expect(isWholeNone("Yes, that's right. That's all for now.")).toBe(false);
  });

  it("'I'd rather skip that one.' and 'Skip that one for now.' are skips", () => {
    for (const said of [
      "I'd rather skip that one.",
      "Skip that one for now.",
      "Let's skip it.",
      "I'd rather not answer that.",
    ]) {
      expect(isWholeSkip(said)).toBe(true);
    }
    expect(isWholeSkip("Skip the crypto ones, but fintech is fine")).toBe(
      false,
    );
  });

  it("portfolio: 'None yet, it's a new fund.' answers it None", () => {
    expect(
      settle({
        lastQTurn: "Could you name a few representative portfolio companies?",
        askedStep: I.portfolio,
        utterance: "None yet, it's a new fund.",
      }),
    ).toEqual({ none: [I.portfolio], notKnown: [] });
  });

  it("portfolio: a skip is recorded as not known", () => {
    expect(
      settle({
        lastQTurn: "Could you name a few representative portfolio companies?",
        askedStep: I.portfolio,
        utterance: "I'd rather skip that one.",
      }),
    ).toEqual({ none: [], notKnown: [I.portfolio] });
  });

  it("company fit skipped the first time is not known for its lists, not asked again", () => {
    const fit = theme("company_fit");
    const settled = settle({
      lastQTurn: `Understood. ${fit.question}`,
      utterance: "Skip that one for now.",
    });
    expect(settled.none).toEqual([]);
    expect([...settled.notKnown].sort()).toEqual([...fit.stepKeys].sort());
  });

  it("while finishing, a none or a skip of the asked step is recorded before the finish", async () => {
    const calls: string[] = [];
    const ok = (kind: string) => () => {
      calls.push(kind);
      return Promise.resolve([{ outcome: "COMMITTED" }]);
    };
    expect(
      await settleFinishingAnswer({
        stepKey: I.portfolio,
        utterance: "None yet, it's a new fund.",
        declinedByReading: false,
        recordNone: ok("none"),
        recordNotKnown: ok("not-known"),
      }),
    ).toBe("NONE");
    expect(
      await settleFinishingAnswer({
        stepKey: I.portfolio,
        utterance: "I'd rather skip that one.",
        declinedByReading: false,
        recordNone: ok("none"),
        recordNotKnown: ok("not-known"),
      }),
    ).toBe("NOT_KNOWN");
    expect(
      await settleFinishingAnswer({
        stepKey: I.portfolio,
        utterance: "Acme and Beta.",
        declinedByReading: false,
        recordNone: ok("none"),
        recordNotKnown: ok("not-known"),
      }),
    ).toBeNull();
    expect(calls).toEqual(["none", "not-known"]);
  });
});

describe("D2: the screen's Finish finishes, or asks what is still needed", () => {
  it("never confirms the mandate review alone while a needed answer is open", async () => {
    let confirmed = 0;
    const done = await confirmTapped({
      tapped: I.review,
      journeyType: "investor",
      finishing: {
        finish: () =>
          Promise.resolve({
            completed: false,
            missing: [
              {
                stepKey: I.portfolio,
                question:
                  "Could you name a few representative portfolio companies?",
              },
            ],
          }),
      },
      state: () => Promise.reject(new Error("not read")),
      confirmOne: () => {
        confirmed += 1;
        return Promise.resolve();
      },
      labelOf: () => undefined,
    });
    expect(confirmed).toBe(0);
    expect(done.completed).toBe(false);
    expect(done.asking).toBe(I.portfolio);
  });

  it("completes on the tap when nothing is open", async () => {
    const done = await confirmTapped({
      tapped: I.review,
      journeyType: "investor",
      finishing: {
        finish: () => Promise.resolve({ completed: true, missing: [] }),
      },
      state: () => Promise.reject(new Error("not read")),
      confirmOne: () => Promise.resolve(),
      labelOf: () => undefined,
    });
    expect(done.completed).toBe(true);
  });
});

describe("D3: no self-withdrawing question, no garbled exclusions re-ask", () => {
  it("'None beyond crypto.' to Q's 'Beyond speculative crypto, what's off the table…' settles the rest None", () => {
    const off = theme("off_the_table");
    const open = new Set(
      off.stepKeys.filter((key) => key !== I.hardExclusions),
    );
    const settled = settle({
      lastQTurn:
        "That makes East Africa important. Beyond speculative crypto, what's off the table for you: anything you'd rather not see, anything that should never be shown to you, or none?",
      utterance: "None beyond crypto.",
      open,
    });
    expect([...settled.none].sort()).toEqual([...open].sort());
    // An exception Q never named is content: the reading's.
    expect(
      settle({
        lastQTurn: off.question,
        utterance: "None beyond tobacco.",
        open,
      }).none,
    ).toEqual([]);
  });

  it("the exclusions follow-up names each list once, plainly", () => {
    const line = themeFollowUp([I.sectorsAvoid, I.avoid, I.sectorExclusions]);
    expect(line).not.toContain("rather not see, rather not see");
    expect(line).toBe(
      "Anything on sectors you'd rather not see, anything else you'd rather not see or sectors to exclude outright, or no preference?",
    );
    // Q's own follow-up is still recognised as asking those lists.
    expect(
      settle({ lastQTurn: line, utterance: "No preference." }).none.length,
    ).toBe(3);
  });

  it("a follow-up never offers the mandate review as the next question", async () => {
    const said: string[] = [];
    await followUpIfAnswered({
      asked: I.hardExclusions,
      stillLast: () => true,
      state: () =>
        Promise.resolve(
          OnboardingStateSchema.parse({
            journey: "investor",
            currentStepKey: null,
            canComplete: false,
            completed: false,
            steps: [
              {
                stepKey: I.hardExclusions,
                question: "Is there anything you never want to be shown?",
                kind: "MANY_OF",
                required: true,
                status: "ANSWERED",
                value: "Speculative crypto",
              },
              {
                stepKey: I.review,
                question: "Here's the mandate you've defined",
                kind: "YES_NO",
                required: true,
                status: "OPEN",
                value: null,
              },
            ],
            checks: [],
            next: [{ stepKey: I.review, reason: "ESSENTIAL_MISSING" }],
          }),
        ),
      say: (line) => {
        said.push(line.text);
        return Promise.resolve();
      },
    });
    expect(said.join(" ")).not.toMatch(/make it live/u);
  });
});

describe("D5: Q offers 'must match' only where Discover enforces it", () => {
  const keys = (stepKey: string) => {
    const step = definitionFor("investor").steps.find(
      (s) => s.stepKey === stepKey,
    );
    if (step === undefined) throw new Error(stepKey);
    return optionsOf(step).map((option) => option.key);
  };
  it("geography keeps must; sector, founder and green-flag strengths do not", () => {
    expect(keys(I.geographyStrength)).toContain("must");
    for (const stepKey of [
      I.sectorStrength,
      I.founderStrength,
      I.greenFlagStrength,
    ]) {
      expect(keys(stepKey)).not.toContain("must");
      expect(keys(stepKey)).toEqual(["strong", "nice"]);
    }
  });
});

describe("D7: a reload does not add another 'Picking up' line", () => {
  it("knows a reopening already picked up since their last words", () => {
    const items = [
      { role: "Q", text: "Could you name a few portfolio companies?" },
      { role: "PERSON", text: "None yet, it's a new fund." },
      { role: "Q", text: "That's fine." },
      { role: "Q", text: "Picking up where we left off. Anything else?" },
    ];
    expect(alreadyPickedUp(items)).toBe(true);
    expect(alreadyPickedUp(items.slice(0, 3))).toBe(false);
    expect(alreadyPickedUp([...items, { role: "PERSON", text: "Yes." }])).toBe(
      false,
    );
  });
});
