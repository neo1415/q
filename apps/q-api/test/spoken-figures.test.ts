import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { liveSpoken, qSpokenWords } from "../src/voice/live/broker.js";
import {
  spokenFigures,
  spokenNumbers,
  speakable,
} from "../src/voice/speech.js";

/**
 * Money and big numbers, said the way a person says them. "200 000 000
 * NGN" was read aloud as a string of zeros followed by three letters.
 */
describe("figures, spoken", () => {
  it("says a raise target as words, not digits and letters", () => {
    expect(spokenFigures("a raise target of 200 000 000 NGN")).toBe(
      "a raise target of 200 million naira",
    );
    expect(spokenFigures("200,000,000 NGN via a convertible note")).toBe(
      "200 million naira via a convertible note",
    );
    expect(spokenFigures("NGN 200,000,000")).toBe("200 million naira");
  });

  it("keeps a written scale word with its figure", () => {
    // Live: "₦200 million" was read out as "200 nairamillion".
    expect(spokenFigures("a ₦200 million convertible-note raise")).toBe(
      "a 200 million naira convertible-note raise",
    );
    expect(spokenFigures("NGN 200 million")).toBe("200 million naira");
    expect(spokenFigures("200 million NGN")).toBe("200 million naira");
    expect(spokenFigures("$2 billion")).toBe("2 billion dollars");
  });

  it("handles the ways models write money", () => {
    expect(spokenFigures("$1.5m")).toBe("1.5 million dollars");
    expect(spokenFigures("USD 250k")).toBe("250 thousand dollars");
    expect(spokenFigures("£2,000,000")).toBe("2 million pounds");
    expect(spokenFigures("raised 3 000 000 USD last year")).toBe(
      "raised 3 million dollars last year",
    );
    expect(spokenFigures("1 USD")).toBe("1 dollar");
  });

  it("compacts a grouped count and leaves a plain number alone", () => {
    expect(spokenFigures("serves 60,000 merchants")).toBe(
      "serves 60 thousand merchants",
    );
    expect(spokenFigures("acquired in 2020")).toBe("acquired in 2020");
    expect(spokenFigures("about 12 people")).toBe("about 12 people");
  });

  it("is applied to everything Q says aloud", () => {
    expect(speakable("Target: **200 000 000 NGN**.")).toBe(
      "Target: 200 million naira.",
    );
  });

  // CQ-VOICE-010 case 08: the upper bound was left as "3m", and voices said
  // it as "three annum" (turbo) and "three meters" (Aura-2).
  it("says a money range as one range in one currency", () => {
    expect(spokenFigures("cheques of USD 250k–3m.")).toBe(
      "cheques of 250 thousand to 3 million dollars.",
    );
    expect(spokenFigures("between $250k-$3m, then")).toBe(
      "between 250 thousand to 3 million dollars, then",
    );
    expect(spokenFigures("raise 250k–3m USD now")).toBe(
      "raise 250 thousand to 3 million dollars now",
    );
    expect(spokenFigures("₦50m–₦200m")).toBe("50 million to 200 million naira");
  });

  it("gives a bare lower bound the upper bound's scale, as a person means it", () => {
    expect(spokenFigures("USD 2–3m")).toBe("2 million to 3 million dollars");
  });

  it("leaves ranges that are not money, and money followed by 'to' something else, alone", () => {
    expect(spokenFigures("in 2020-2021 we")).toBe("in 2020-2021 we");
    expect(spokenFigures("14–16 March")).toBe("14–16 March");
    expect(spokenFigures("USD 5m to 10 founders")).toBe(
      "5 million dollars to 10 founders",
    );
  });
});

/**
 * Audit 15 Nov 2026 (RC1, investor v-47e5ab44-039, run 2f1153d1): a
 * mandate about to be approved, "€50,000–€100 million", was heard as "50
 * billion to 100 million euros". The live voice is handed every figure in
 * words, by code.
 */
describe("figures handed to the live voice", () => {
  it("never gives a grouped lower bound the upper bound's scale", () => {
    expect(spokenFigures("€50,000–€100 million")).toBe(
      "50 thousand to 100 million euros",
    );
    // A bare lower bound still takes it, as a person means it.
    expect(spokenFigures("USD 2–3m")).toBe("2 million to 3 million dollars");
    // And never one that would then exceed the upper bound.
    expect(spokenFigures("€500–€2 million")).toBe("500 to 2 million euros");
  });

  it("says the live case in words, never 'billion'", () => {
    const said = liveSpoken(
      "Your cheque range is €50,000–€100 million, typical €3 million.",
    );
    expect(said).toBe(
      "Your cheque range is fifty thousand to one hundred million euros, typical three million euros.",
    );
    expect(said).not.toMatch(/billion|\d/u);
    expect(
      qSpokenWords({
        facts: null,
        said: "Pre-seed, €50,000–€100 million.",
        approvalPending: false,
      }),
    ).toBe("Pre-seed, fifty thousand to one hundred million euros.");
  });

  it("formats money, years, dates, times and percentages deterministically", () => {
    expect(spokenNumbers("€50,000")).toBe("fifty thousand euros");
    expect(spokenNumbers("$1.5m")).toBe("one point five million dollars");
    expect(spokenNumbers("founded in 2019, raising in 2026")).toBe(
      "founded in twenty nineteen, raising in twenty twenty-six",
    );
    expect(spokenNumbers("since 2005")).toBe("since two thousand and five");
    expect(spokenNumbers("Monday 16 November at 10:00")).toBe(
      "Monday sixteenth November at ten o'clock",
    );
    expect(spokenNumbers("on November 3 at 9:30")).toBe(
      "on November third at nine thirty",
    );
    expect(spokenNumbers("gross margin of 42.5%")).toBe(
      "gross margin of forty-two point five percent",
    );
    expect(spokenNumbers("serves 60,000 merchants in 12 markets")).toBe(
      "serves sixty thousand merchants in twelve markets",
    );
    expect(spokenNumbers("a 2,500 person team")).toBe(
      "a two thousand five hundred person team",
    );
  });
});

describe("replay: the investor's mandate line (investor-turns.jsonl v-47e5ab44-039)", () => {
  it("hands the voice Q's figures in words, never the 'billion' it said", () => {
    const record = readFileSync(
      new URL(
        "../../../docs/ai-handoff/audits/2026-11-15-q-voice-audit/investor-turns.jsonl",
        import.meta.url,
      ),
      "utf8",
    )
      .split("\n")
      .filter((line) => line.includes('"turn_id":"v-47e5ab44-039"'))
      .map((line) => JSON.parse(line) as { q_text: string; spoken: string })[0];
    expect(record?.spoken).toContain("50 billion");
    const said = liveSpoken(record?.q_text ?? "");
    expect(said).toContain(
      "with fifty thousand to one hundred million euros cheques and a three million euros typical cheque",
    );
    expect(said).not.toMatch(/billion/u);
  });
});
