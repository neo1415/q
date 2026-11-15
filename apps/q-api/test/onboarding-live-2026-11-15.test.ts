import { describe, expect, it } from "vitest";

import { completedNote } from "../src/voice/onboarding-conversation.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { isReadBackLine, savedSoFar } from "../src/voice/typed-onboarding.js";
import { alsoSaid, beyondPieces } from "../src/voice/onboarding-port.js";

describe("D2: the founder's close says what is true", () => {
  const copy = { labelOf: () => undefined, questionOf: () => null };

  it("typed: no promise of matching while the company is private and unverified", () => {
    const said = finishingLine(
      "founder",
      { completed: true, missing: [] },
      copy,
    );
    expect(said?.reply).toMatch(/saved/u);
    expect(said?.reply).not.toMatch(/will now be matched/u);
    expect(said?.reply).toMatch(/verified/u);
    expect(said?.reply).toMatch(/visible/u);
    expect(said?.reply).toMatch(/after that/iu);
  });

  it("voice: Q is told the same, never to promise matching now", () => {
    const note = completedNote("founder");
    expect(note).not.toMatch(/investors who fit will now be matched/u);
    expect(note).toMatch(/verified/u);
    expect(note).toMatch(/visible/u);
  });

  it("the investor's close is unchanged", () => {
    const said = finishingLine(
      "investor",
      { completed: true, missing: [] },
      copy,
    );
    expect(said?.reply).toMatch(/Your mandate is saved and live/u);
  });
});

/**
 * Live founder onboarding on production, 2026-11-15
 * (docs/ai-handoff/audits/2026-11-15-founder-onboarding-live.md). Each case
 * is the run's own shape.
 */

describe("D1: what the deck answered is never 'still to cover'", () => {
  const row = (
    stepKey: string,
    status: "ANSWERED" | "OPEN",
    value: string | null,
  ) => ({
    stepKey,
    question: `${stepKey}?`,
    kind: "ONE_OF" as const,
    required: true,
    status,
    value,
  });
  const labels: Record<string, string> = {
    "F1.company_name": "Company name",
    "F1.description": "What the company does",
    "F5.signal": "Early signal",
    "F6.raising": "Raising now",
  };
  const state = {
    journey: "founder" as const,
    currentStepKey: null,
    canComplete: false,
    completed: false,
    checks: [],
    steps: [
      row("F1.company_name", "ANSWERED", "Mangrove Tally (fictional)"),
      row("F1.description", "OPEN", null),
      row("F5.signal", "OPEN", null),
      row("F6.raising", "OPEN", null),
    ],
  };

  it("a deck suggestion waits for their yes, and is not saved", () => {
    const said = savedSoFar(state, "founder", (key) => labels[key], [
      { stepKey: "F1.description", fromDocument: true },
    ]);
    expect(said).toMatch(
      /Read from your deck, not saved until you confirm: what the company does\./u,
    );
    expect(said).toMatch(/Still to cover: early signal, raising now\.$/u);
    expect(said).not.toMatch(/Still to cover: what the company does/u);
    expect(said).not.toMatch(/Company name: .*\n.*What the company does:/u);
  });

  it("with nothing waiting, the list is as before", () => {
    const said = savedSoFar(state, "founder", (key) => labels[key]);
    expect(said).toMatch(
      /Still to cover: what the company does, early signal, raising now\.$/u,
    );
  });
});

describe("D6: a held value read from the deck is said as from the deck", () => {
  const missing = [
    { stepKey: "F6.use_of_funds", question: "What will the raise fund?" },
  ];
  const copy = {
    labelOf: () => "Use of funds",
    questionOf: () => null,
    heldFor: () =>
      "Product and engineering, Sales and go-to-market, Runway and operations",
  };

  it("never 'From what you said' for the deck's value", () => {
    const said = finishingLine(
      "founder",
      { completed: false, missing },
      { ...copy, heldFromDocument: () => true },
    );
    expect(said?.reply).toMatch(/From your deck:/u);
    expect(said?.reply).not.toMatch(/From what you said/u);
    expect(isReadBackLine(said?.reply ?? "")).toBe(true);
  });

  it("their own words are still 'From what you said'", () => {
    const said = finishingLine("founder", { completed: false, missing }, copy);
    expect(said?.reply).toMatch(/From what you said:/u);
    expect(isReadBackLine(said?.reply ?? "")).toBe(true);
  });
});

describe("D4: their words beside a choice are quoted in whole clauses", () => {
  const SAID =
    "1,850 paying retailers and US$42,000 MRR in October, growing about 11% a month";

  it("never splits at a thousands separator", () => {
    const pieces = beyondPieces(SAID, [SAID], ["Paying customers"]);
    expect(pieces.some((piece) => /^\d{3}\b/u.test(piece))).toBe(false);
    expect(pieces).toContain(
      "1,850 paying retailers and US$42,000 MRR in October",
    );
    expect(pieces).toContain("growing about 11% a month");
    const quoted = alsoSaid(pieces.join("; "));
    expect(quoted).not.toMatch(/“000/u);
    expect(quoted).toMatch(/US\$42,000 MRR in October/u);
  });

  it("still splits a list at its commas (Kivisild, 2026-11-02)", () => {
    const said = "3 paying customers, 40 lockers in 12 towns";
    expect(
      beyondPieces("3, 40 lockers in 12 towns", [said], ["Paying customers"]),
    ).toEqual(["40 lockers in 12 towns"]);
  });
});
