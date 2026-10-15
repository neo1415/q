import { describe, expect, it } from "vitest";

import {
  dailyFollowUpKind,
  editionDay,
  quietDayNewsWords,
  type DailyNewsStory,
} from "../src/speech/daily-news.js";

const story = (headline: string): DailyNewsStory => ({
  storyId: headline,
  headline,
  summary: "s",
  detail: null,
  editionDate: "2026-10-08",
  sources: [{ publisher: "TechCabal" }],
});

describe("daily news words", () => {
  it("dates an edition", () => {
    expect(editionDay("2026-10-08")).toBe("8 October");
    expect(editionDay("nope")).toBeNull();
  });

  it("says nothing without a prepared story", () => {
    expect(
      quietDayNewsWords({ stories: [], now: new Date(), who: "Zino" }),
    ).toBeNull();
  });

  it("mentions at most two stories", () => {
    const text = quietDayNewsWords({
      stories: [story("One."), story("Two"), story("Three")],
      now: new Date("2026-10-10T10:00:00Z"),
      who: "Zino",
    });
    expect(text).toContain("One");
    expect(text).toContain("Two");
    expect(text).not.toContain("Three");
    expect(text).toContain("8 October");
  });

  it.each([
    ["give me the gist", "GIST"],
    ["can I get the short version", "GIST"],
    ["tell me more", "MORE"],
    ["what's the full story", "MORE"],
    ["open it", "OPEN"],
    ["take me there", "OPEN"],
    ["open the second one", "OPEN"],
    ["show me that section", "SECTION"],
  ])("%s is %s", (text, kind) => {
    expect(dailyFollowUpKind(text)).toBe(kind);
  });

  it.each([
    "tell me more about Halyard",
    "open my chat with Halyard",
    "open settings",
    "what is my runway",
  ])("%s is not a Daily follow-up", (text) => {
    expect(dailyFollowUpKind(text)).toBeNull();
  });
});
