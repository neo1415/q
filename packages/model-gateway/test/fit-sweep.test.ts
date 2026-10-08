import { describe, expect, it } from "vitest";

import { withOneCaveat } from "@capital-q/q-core";

import { askedCount, fitSweepAsk } from "../src/q/fit-sweep.js";
import {
  claimsListOnScreen,
  withoutUnbackedScreenClaims,
} from "../src/q/screen-claims.js";

/** voice-cards (Zino 2026-10-08): "top three" is three cards, not ten. */
describe("how many companies were asked for", () => {
  it.each([
    [
      "Show me the top three companies that are aligned against the mandate.",
      3,
    ],
    ["Top 3 startups from South Africa for me?", 3],
    ["What are my five best matches?", 5],
    ["Give me the best two fits", 2],
    ["show me 4 companies that fit my mandate", 4],
    ["Which companies fit my mandate?", null],
    ["Rank my saved companies", null],
    ["top 25 companies", null],
  ])("%s -> %s", (question, expected) => {
    expect(askedCount(question)).toBe(expected);
  });

  it("is carried on the fit question's reading", () => {
    expect(
      fitSweepAsk(
        "Show me the top three companies that are aligned against the mandate.",
      )?.count,
    ).toBe(3);
  });
});

/** Lead live replay 2026-10-07: what code reads from the question. */
describe("a fit question over a set the person owns", () => {
  it.each([
    [
      "List the companies that have been reached out to so far and their scores against the mandate, including pros and cons of investing in them.",
      { scope: "RELATIONSHIPS", place: null, fitAsked: true, count: null },
    ],
    [
      "Which specific companies in Kenya closely match the criteria?",
      { scope: "CANDIDATES", place: "Kenya", fitAsked: true, count: null },
    ],
    [
      "What are the companies that you've reached out to?",
      { scope: "RELATIONSHIPS", place: null, fitAsked: false, count: null },
    ],
    [
      "Rank my saved companies",
      { scope: "SAVED", place: null, fitAsked: true, count: null },
    ],
    [
      "Top 3 startups from South Africa for me?",
      { scope: "CANDIDATES", place: "South Africa", fitAsked: true, count: 3 },
    ],
  ])("%s", (question, expected) => {
    expect(fitSweepAsk(question)).toEqual(expected);
  });

  it.each([
    "How is my raise going?",
    "Tell me about Portside",
    "Book a call with Baridi tomorrow",
    "What does fit mean?",
  ])("is not one: %s", (question) => {
    expect(fitSweepAsk(question)).toBeNull();
  });

  it("never answers 'the best way to reach out' with fit cards", () => {
    // At most the cards beside the model's own answer, for names it says.
    expect(
      fitSweepAsk("What's the best way to reach out to companies?")?.fitAsked,
    ).toBe(false);
  });
});

describe("'on screen' only with something on screen", () => {
  it("drops an unbacked list claim without apologising", () => {
    expect(claimsListOnScreen("The others are listed on screen.")).toBe(true);
    expect(
      withoutUnbackedScreenClaims(
        "I've reached out to 20 companies. The other contacted companies are listed on screen. They're on screen.",
        false,
      ).text,
    ).toBe("I've reached out to 20 companies.");
    expect(withoutUnbackedScreenClaims("They're on screen.", true).text).toBe(
      "They're on screen.",
    );
  });
});

describe("one disclaimer at most", () => {
  it("removes appended disclaimers and repeats, never an evidence caveat", () => {
    const { text } = withOneCaveat(
      "Both match your stage—this is mandate alignment—not an investment conclusion. Round size isn't known yet. That is a prioritisation for diligence, not an investment recommendation. Maji Loop is closer, not a platform verdict.",
    );
    expect(text).toBe(
      "Both match your stage. Round size isn't known yet. That is a prioritisation for diligence. Maji Loop is closer.",
    );
  });
});
