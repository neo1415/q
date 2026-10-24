import { describe, expect, it } from "vitest";

import { callPrepLine, type CallPrep } from "../src/call-prep.js";

/**
 * Owner QA O-I12 (2026-10-24): an investor's prep for Spheros read as the
 * founder's ("What they'll likely ask… You have secured 10 clients"). The
 * prep's sections follow whose side it is from.
 */
const base = {
  counterpartName: "Spheros",
  whoTheyAre: "A Lagos fintech at seed",
  soFar: "First contact",
  questions: [
    {
      question: "Which clients pay?",
      answer: "names and contract values; ask for two references",
    },
    {
      question: "What is churn?",
      answer: "a monthly figure; verify against the data room",
    },
    { question: "Why now?", answer: "a market change they can evidence" },
  ],
  weakSpots: [
    { spot: "Only 2 of 10 clients pay", handle: "Ask what converts a pilot" },
  ],
  ask: "Propose a data request and a partner meeting",
  waiting: [],
} as const;

describe("a call prep, by whose side it is from", () => {
  it("an investor's: questions to ask, red flags, what the founder will want, never the founder's voice", () => {
    const prep: CallPrep = {
      ...base,
      viewerRole: "INVESTOR",
      theyWant: "A cheque toward their USD 1m round and introductions to banks",
    };
    const text = callPrepLine(prep);
    expect(text).toContain(
      "**What to ask them**\n1. Which clients pay?\n   Listen for: names and contract values",
    );
    expect(text).toContain(
      "**Red flags to test**\n- Only 2 of 10 clients pay.",
    );
    expect(text).toContain(
      "**What they'll want from you**\nA cheque toward their USD 1m round and introductions to banks.",
    );
    expect(text).not.toContain("What they'll likely ask");
    expect(text).not.toContain("Weak spots");
    expect(text.endsWith("Want to rehearse it? I'll play Spheros.")).toBe(true);
  });

  it("a founder's: the investor's likely questions and weak spots, with no 'what they want' section", () => {
    const text = callPrepLine({
      ...base,
      viewerRole: "FOUNDER",
      theyWant: "ignored",
    });
    expect(text).toContain(
      "**What they'll likely ask**\n1. Which clients pay?\n   names",
    );
    expect(text).toContain("**Weak spots**");
    expect(text).not.toContain("What they'll want from you");
    expect(text).not.toContain("Listen for:");
  });
});
