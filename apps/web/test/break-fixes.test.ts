import { describe, expect, it } from "vitest";

import { absentSentence } from "../src/features/relationships/relationship-words";

/** Break-it sweep 2026-10-03. */
describe("a relationship page with nothing on record", () => {
  it("says nothing is on record when the read worked, from either side", () => {
    expect(absentSentence(true, "company", "Zino Aviation")).toBe(
      "Nothing is on record yet between your company and Zino Aviation.",
    );
    expect(absentSentence(true, "organisation", "Nixo")).toBe(
      "Nothing is on record yet between your organisation and Nixo.",
    );
  });

  it("says it couldn't load only when the read failed", () => {
    expect(absentSentence(false, "company", "Zino Aviation")).toMatch(
      /couldn't load just now/,
    );
  });
});

describe("a Discover decision that did not land", () => {
  it("says it wasn't saved, in the action's own words", async () => {
    const { decisionFailureWords } =
      await import("../src/features/discover/feed/use-investor-feed");
    expect(
      decisionFailureWords(
        new Error("You are signed out. Sign in and try again."),
      ),
    ).toBe("That wasn't saved. You are signed out. Sign in and try again.");
    expect(decisionFailureWords(new Error(""))).toBe(
      "That wasn't saved. Try again in a moment.",
    );
  });
});

describe("a reminder's time", () => {
  it("names the year only when it is not this year", async () => {
    const { when } =
      await import("../src/features/schedule/relationship-schedule-controls");
    const now = new Date("2026-10-03T12:00:00Z");
    expect(when("2025-01-01T09:00:00Z", now)).toMatch(/2025/);
    expect(when("2026-11-01T08:30:00Z", now)).not.toMatch(/2026/);
  });
});
