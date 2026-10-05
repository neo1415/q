import { describe, expect, it } from "vitest";

import {
  questionVerdict,
  type ThreadFacts,
} from "../src/composition/instructions/engine.js";

/**
 * Live 2026-10-05: Spheros wrote to Zino, whose instruction sends messages
 * only with his yes. Q handed the question back ("reply in the chat")
 * instead of drafting a reply for his approval. Whether Q may answer is
 * about the facts, never the mode: under ASK the draft becomes a card.
 */
const thread = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  lastFrom: "THEM",
  asksQuestion: true,
  wantsToMeet: false,
  proposedTime: null,
  topicNumbers: [1],
  mentionsTermsOrMoney: false,
  declined: false,
  tone: "NEUTRAL",
  ...over,
});

describe("their question, whatever the message mode", () => {
  it("an answerable question is answerable (the draft becomes a card under ASK)", () => {
    expect(questionVerdict(thread(), [])).toBe("ANSWERABLE");
  });

  it("terms or money stay the person's; a fact they never declared is never guessed", () => {
    expect(questionVerdict(thread({ mentionsTermsOrMoney: true }), [])).toBe(
      "TERMS_OR_MONEY",
    );
    expect(
      questionVerdict(
        thread({ topicNumbers: [], questionAbout: ["OTHER"] }),
        [],
      ),
    ).toBe("NOT_DECLARED");
  });

  it("nothing to answer when they did not ask, or we wrote last", () => {
    expect(questionVerdict(thread({ asksQuestion: false }), [])).toBeNull();
    expect(questionVerdict(thread({ lastFrom: "US" }), [])).toBeNull();
  });
});
