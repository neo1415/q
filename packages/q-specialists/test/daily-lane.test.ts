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
    "anything else in Q Daily?",
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
