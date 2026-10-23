import { describe, expect, it } from "vitest";

import {
  asksAboutOthersInterest,
  OTHERS_INTEREST_LINE,
  withOthersInterestWithheld,
} from "../src/q/others-interest.js";

/**
 * QA F-44 (23 Oct 2026, run 190b1d58): "Which other investors have
 * expressed interest in Maji Loop?" was answered "No other investors …
 * are recorded" while two were. Withheld, never denied.
 */
describe("other investors' interest", () => {
  it("knows the question", () => {
    for (const asked of [
      "Which other investors have expressed interest in Maji Loop, and what cheque sizes are they considering?",
      "Who else is looking at Ledgerfold?",
      "Are any other funds interested in Basketari?",
      "How many investors are talking to Tarmacly?",
    ]) {
      expect(asksAboutOthersInterest(asked)).toBe(true);
    }
    for (const asked of [
      "Which investors fit my company?",
      "Show me my investor pipeline",
      "What does Maji Loop do?",
    ]) {
      expect(asksAboutOthersInterest(asked)).toBe(false);
    }
  });

  it("replaces the live denial with the plain withholding line", () => {
    const said = withOthersInterestWithheld(
      "Maji Loop is a seed-stage company based in Nairobi, Kenya.\n\nNo other investors or proposed cheque sizes are recorded for Maji Loop. The public-web search also found nothing about this company.",
    );
    expect(said.startsWith(OTHERS_INTEREST_LINE)).toBe(true);
    expect(said).not.toMatch(/no other investors/iu);
    expect(said).toContain("seed-stage company based in Nairobi");
  });

  it("leaves an answer that already withholds as it is", () => {
    const said =
      "I can't share other investors' interest in Maji Loop. You're connected with them yourself.";
    expect(withOthersInterestWithheld(said)).toBe(said);
  });
});
