import { describe, expect, it } from "vitest";

import {
  INVESTOR_PUBLIC_DESCRIPTION_STEP,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";

import { finishingLine } from "../src/voice/onboarding-flow.js";
import { coverageProfileFor } from "../src/voice/onboarding-port.js";
import {
  heldOfferedIn,
  isPlainYes,
  isReadBackLine,
} from "../src/voice/typed-onboarding.js";

/**
 * e2e run 6 (production batch 10, 2026-11-08):
 * - Q14 read the cheque back and, in the same line, "How would you
 *   describe …": the firm description was labelled by its question.
 * - "Are those musts, or more of a preference?" asked 13 times, word for
 *   word, to a non-answer.
 * One yes means one thing; a needed question is never looped (DECISIONS 77).
 */
const I = INVESTOR_STEPS;
const labelOf = (key: string) =>
  coverageProfileFor("investor").fields[key]?.label;
const STRENGTH = I.greenFlagStrength;
const CHOICES = ["Must match", "Strong preference", "Nice to have"];
const ask = (
  missing: readonly string[],
  repeats: Readonly<Record<string, number>> = {},
  heldFor: (key: string) => string | null = () => null,
) =>
  finishingLine(
    "investor",
    {
      completed: false,
      missing: missing.map((stepKey) => ({
        stepKey,
        question: `Question ${stepKey}?`,
      })),
    },
    {
      labelOf,
      questionOf: (key) =>
        key === STRENGTH
          ? "Are those musts, or more of a preference?"
          : key === INVESTOR_PUBLIC_DESCRIPTION_STEP
            ? "How would you describe your firm to a founder?"
            : null,
      heldFor,
      repeats: (key) => repeats[key] ?? 0,
      choicesOf: (key) => (key === STRENGTH ? CHOICES : []),
    },
  );

describe("a read-back is the only question in its line", () => {
  it("labels the firm description as itself, never by its question", () => {
    const held: Readonly<Record<string, string>> = {
      [I.chequeMin]: "$250,000",
      [I.chequeTypical]: "$500,000",
      [I.chequeMax]: "$1 million",
      [INVESTOR_PUBLIC_DESCRIPTION_STEP]:
        "We back early fintech in West Africa",
    };
    const said = ask(
      [
        I.chequeMin,
        I.chequeTypical,
        I.chequeMax,
        INVESTOR_PUBLIC_DESCRIPTION_STEP,
      ],
      {},
      (key) => held[key] ?? null,
    );
    const reply = said?.reply ?? "";
    expect(reply).not.toMatch(/How would you describe/u);
    expect(reply).toMatch(/Firm description: We back early fintech/u);
    expect(reply.match(/\?/gu) ?? []).toHaveLength(1);
    expect(reply).toMatch(/Shall I keep these\?/u);
  });
});

describe("a needed question after a non-answer (DECISIONS 77)", () => {
  it("the second time: why, and its choices in plain words", () => {
    const said = ask([STRENGTH], { [STRENGTH]: 1 });
    expect(said?.reply).toBe(
      "Just so I can match you well, I need this one before I can finish. Are those musts, or more of a preference: Must match, Strong preference or Nice to have?",
    );
    expect(said?.asking).toBe(STRENGTH);
  });

  it("the third time, alone: left for now, and nothing asked", () => {
    const said = ask([STRENGTH], { [STRENGTH]: 2 });
    expect(said?.asking).toBeNull();
    expect(said?.reply).not.toMatch(/\?/u);
    expect(said?.reply).toMatch(/let's leave green-flag firmness for now/u);
  });

  it("the third time, with others open: another needed one goes first", () => {
    const said = ask([STRENGTH, I.inboundPreference], { [STRENGTH]: 2 });
    expect(said?.asking).toBe(I.inboundPreference);
  });
});

describe("a plain yes to code's read-back is a yes to exactly what it read back", () => {
  const READ_BACK =
    "Before I can finish, I need your yes on these. From what you said:\n\nMinimum cheque: $250,000\nTypical cheque: $500,000\nMaximum cheque: $1 million\n\nShall I keep these? Say yes, or tell me what to change.";

  it("knows a plain yes, and code's read-back line", () => {
    for (const said of ["Yes.", "yes please", "That's right.", "Keep them"]) {
      expect(isPlainYes(said)).toBe(true);
    }
    for (const said of ["Yes, but make the maximum 2 million", "No"]) {
      expect(isPlainYes(said)).toBe(false);
    }
    expect(isReadBackLine(READ_BACK)).toBe(true);
    expect(isReadBackLine("Shall I make your mandate live?")).toBe(false);
  });

  it("the offer it approves is the set that line read back", () => {
    const held = [
      { stepKey: I.chequeMin, value: "$250,000" },
      { stepKey: I.chequeTypical, value: "$500,000" },
      { stepKey: I.chequeMax, value: "$1 million" },
      { stepKey: I.inboundPreference, value: "Only well-matched founders" },
    ];
    expect(
      heldOfferedIn(held, I.chequeMin, READ_BACK).map((item) => item.stepKey),
    ).toEqual([I.chequeMin, I.chequeTypical, I.chequeMax]);
  });
});
