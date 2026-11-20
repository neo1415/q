import { describe, expect, it } from "vitest";

import {
  answerPlanOf,
  endsWithOffer,
  naturalRegisterIssues,
  offerAllowedFor,
  questionCount,
} from "../src/index.js";

/**
 * HQ-2 (conversation audit §2.3, §2.8): the robotic tells, named by code.
 * The lint never blocks an answer; production logs the kinds only.
 */
describe("the humanness lint (HQ-2)", () => {
  it("names relay phrasing, and leaves first person about Q's own work alone", () => {
    for (const said of [
      "I'll ask them about their churn.",
      "I'll pass that on to the founder.",
      "Let me check with the investor and come back.",
      "The investor would like to see your deck.",
    ]) {
      expect(naturalRegisterIssues(said), said).toContain("RELAY_PHRASE");
    }
    for (const said of [
      "I'd start with Portside.",
      "I'll ask you one thing first: which quarter?",
      'They wrote "I\'ll ask my partner" in the thread.',
    ]) {
      expect(naturalRegisterIssues(said), said).not.toContain("RELAY_PHRASE");
    }
  });

  it("names a closing offer only where none is allowed", () => {
    const said = "Their runway is about nine months. Want me to pull the deck?";
    expect(naturalRegisterIssues(said, { offerAllowed: false })).toContain(
      "CHATBAIT_ENDING",
    );
    expect(naturalRegisterIssues(said, { offerAllowed: true })).not.toContain(
      "CHATBAIT_ENDING",
    );
    expect(naturalRegisterIssues(said)).not.toContain("CHATBAIT_ENDING");
    for (const ending of [
      "Would you like me to draft it?",
      "Shall I compare them?",
      "Anything else?",
      "If you'd like, I can go deeper.",
      "Let me know if you want the detail.",
    ]) {
      expect(endsWithOffer(`Done. ${ending}`), ending).toBe(true);
    }
    expect(endsWithOffer("Which quarter do you mean?")).toBe(false);
  });

  it("counts questions outside quotes and code: two or more are stacked", () => {
    expect(questionCount("Which quarter? And which fund?")).toBe(2);
    expect(naturalRegisterIssues("Which quarter? And which fund?")).toContain(
      "STACKED_QUESTIONS",
    );
    expect(
      naturalRegisterIssues(
        'They asked "why now?" and "why you?". I think Q3.',
      ),
    ).not.toContain("STACKED_QUESTIONS");
    expect(naturalRegisterIssues("Which quarter do you mean?")).not.toContain(
      "STACKED_QUESTIONS",
    );
  });

  it("names a sycophantic opener, not a plain answer", () => {
    for (const said of [
      "Great question! Their runway is short.",
      "Love that idea, it fits.",
      "That's a great point. Here is why.",
    ]) {
      expect(naturalRegisterIssues(said), said).toContain("SYCOPHANTIC_OPENER");
    }
    expect(
      naturalRegisterIssues("Their runway is about nine months."),
    ).not.toContain("SYCOPHANTIC_OPENER");
  });
});

describe("provenance in the sentence, not bolted on (owner, 20 Nov 2026)", () => {
  it("names the old disclaimer forms", () => {
    for (const said of [
      "Ledgerfold is at the seed stage. That is what the company declares on Capital Q; it isn't verified.",
      "Here's where they're based: A (Lagos). Locations are what each company declares on Capital Q; they aren't verified.",
      "Tensorgate: seed stage. That is what each declares on Capital Q.",
    ]) {
      expect(naturalRegisterIssues(said), said).toContain(
        "BOLTED_ON_DISCLAIMER",
      );
    }
  });

  it("leaves natural attribution alone", () => {
    for (const said of [
      "Ledgerfold describes itself as being at the seed stage.",
      "According to its own profile, Ledgerfold is raising a seed round.",
      "Ledgerfold lists Lagos as its base.",
    ]) {
      expect(naturalRegisterIssues(said), said).toEqual([]);
    }
  });
});

describe("offers only at natural breaks (HQ-2 slice 3)", () => {
  it.each([
    [["LOOKUP"], undefined, false],
    [["CHAT"], undefined, false],
    [["FOLLOW_UP"], undefined, false],
    [["ANALYSIS"], undefined, true],
    [["COMPARISON"], undefined, true],
    [[], "ADVICE", true],
  ] as const)("%j %s -> %s", (kinds, questionKind, allowed) => {
    expect(
      offerAllowedFor(answerPlanOf({ answerKinds: [...kinds], questionKind })),
    ).toBe(allowed);
  });

  it("never after a clarifying or discovery question; an assumption follows its work", () => {
    expect(
      offerAllowedFor(
        answerPlanOf({
          answerKinds: ["ANALYSIS"],
          underspecified: true,
          costlyIfWrong: true,
        }),
      ),
    ).toBe(false);
    expect(
      offerAllowedFor(answerPlanOf({ answerKinds: [], underspecified: true })),
    ).toBe(false);
    expect(
      offerAllowedFor(
        answerPlanOf({ answerKinds: ["ANALYSIS"], underspecified: true }),
      ),
    ).toBe(true);
    expect(offerAllowedFor(null)).toBeNull();
  });
});
