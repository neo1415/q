import { describe, expect, it } from "vitest";

import { dailyLaneOf } from "../src/fast-lane.js";

describe("dailyLaneOf: Daily-only follow-ups skip the first reads (live 2026-10-11)", () => {
  for (const said of [
    "Give me the gist",
    "what's the gist?",
    "What's the full story?",
    "show me that section",
    "take me to the story",
    "open that article",
  ]) {
    it(`"${said}" is a Daily follow-up`, () => {
      expect(dailyLaneOf(said)?.questionKind).toBe("DAILY_FOLLOW_UP");
    });
  }
  for (const said of [
    "open it",
    "tell me more",
    "open Tensorgate's pitch deck",
    "draft an email about that story",
    "who is Shadi Qishta?",
    // Audit item 1: words the Daily answer cannot answer by code wait for
    // the reading (they were answered with no story bound and no reading).
    "anything else in Q Daily?",
    "i want to read the news",
    "So before this section where there is listening",
  ]) {
    it(`"${said}" is left to the reader`, () => {
      expect(dailyLaneOf(said)).toBeNull();
    });
  }
});

describe("a bare ordinal after stories, not after cards (live 2026-10-11)", () => {
  it("'the other one' is a Daily follow-up when no cards were shown", () => {
    expect(dailyLaneOf("the other one")?.questionKind).toBe("DAILY_FOLLOW_UP");
    expect(dailyLaneOf("The first one.")?.questionKind).toBe("DAILY_FOLLOW_UP");
  });
  it("after cards it is left to the reader (it means a card)", () => {
    expect(dailyLaneOf("the other one", true)).toBeNull();
  });
});

describe("audit item 1: the Daily lane is instant only after Q's own Daily line", () => {
  const gist =
    "Lagos fintech raises a seed round. The round was led by a local fund. Want more, or shall I open it?";
  const two =
    "Lagos fintech raises a seed round. A summary. The other story was Nairobi logistics expands. Want that one, or shall I open this one?";
  const which =
    "Which one do you mean: Lagos fintech raises a seed round, or Nairobi logistics expands?";
  const opened = "Opening the story in the Daily: Lagos fintech raises.";

  it("exact forms after Q's Daily line stay on the instant path", () => {
    expect(dailyLaneOf("the other one", false, two)?.questionKind).toBe(
      "DAILY_FOLLOW_UP",
    );
    expect(dailyLaneOf("the first one", false, which)?.questionKind).toBe(
      "DAILY_FOLLOW_UP",
    );
    expect(dailyLaneOf("what's the full story?", false, gist)).not.toBeNull();
    expect(dailyLaneOf("show me that section", false, opened)).not.toBeNull();
  });

  it("the same words after any other line of Q's wait for the reading", () => {
    const company =
      "Ledgerline is a Series A payments company. Its burn is not disclosed.";
    for (const said of [
      "first",
      "the first one",
      "give me the gist",
      "what's the full story?",
    ]) {
      expect(dailyLaneOf(said, false, company)).toBeNull();
    }
  });
});
