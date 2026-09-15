import { describe, expect, it } from "vitest";

import {
  looksLikeQuestionForQ,
  pauseIntent,
  resumeIntent,
  thinkingIntent,
} from "../src/domain/interview-moves.js";

/**
 * The interview's own moves, one implementation for the typed and the
 * spoken thread (CQ-Q-VOICE-001 B §23-§25, C §35, D §55).
 */

describe("looksLikeQuestionForQ", () => {
  it("routes questions and request-shaped sentences to Q, keeps the interview's own why", () => {
    expect(looksLikeQuestionForQ("What did my deck say about churn?")).toBe(
      true,
    );
    expect(
      looksLikeQuestionForQ("Tell me about Series A rounds in Nigeria"),
    ).toBe(true);
    expect(looksLikeQuestionForQ("Can you check what Paystack raised")).toBe(
      true,
    );
    expect(looksLikeQuestionForQ("Why do you need this?")).toBe(false);
    expect(
      looksLikeQuestionForQ(
        "We make AI software for freight forwarders and logistics companies.",
      ),
    ).toBe(false);
    expect(looksLikeQuestionForQ("Lagos")).toBe(false);
  });
});

describe("resume, pause, thinking", () => {
  it("hears the packet's phrases", () => {
    for (const phrase of [
      "Let's continue.",
      "Continue the interview.",
      "Where were we?",
      "Back to onboarding.",
      "Carry on.",
      "Let's finish this.",
    ]) {
      expect(resumeIntent(phrase), phrase).toBe(true);
    }
    for (const phrase of [
      "Let's stop here.",
      "I'll finish this later.",
      "Pause the interview.",
    ]) {
      expect(pauseIntent(phrase), phrase).toBe(true);
    }
    for (const phrase of [
      "Let me think.",
      "Hmm, give me a second",
      "Hold on a moment",
    ]) {
      expect(thinkingIntent(phrase), phrase).toBe(true);
    }
    expect(resumeIntent("We continue to sell in Ghana")).toBe(false);
    expect(pauseIntent("We stopped selling hardware")).toBe(false);
    expect(thinkingIntent("I think we're Series A")).toBe(false);
  });
});
