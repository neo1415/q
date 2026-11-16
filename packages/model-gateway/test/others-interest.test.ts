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

  // Live re-check of 3b7145616 (16 Nov 2026): a founder's own pipeline
  // ("the ones we're already talking to") opened with the withholding
  // line, though nothing asked about other investors' interest or cheques.
  it("an ask about their own conversations or fit is not about others' interest", () => {
    for (const asked of [
      "Which investors suit us best, excluding the ones we're already talking to?",
      "Which investors are a good fit for us, but skip the ones I'm already in conversation with?",
      "Which funds would back us, leaving out those already talking to us?",
      "Who else should we pitch, apart from the investors we're in talks with?",
    ]) {
      expect(asksAboutOthersInterest(asked), asked).toBe(false);
    }
    for (const asked of [
      "Which other investors are talking to Maji Loop?",
      "Which investors suit us best, and which other investors are interested in Maji Loop?",
    ]) {
      expect(asksAboutOthersInterest(asked), asked).toBe(true);
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
