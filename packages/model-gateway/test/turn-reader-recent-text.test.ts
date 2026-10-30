import { describe, expect, it } from "vitest";

import {
  TURN_READER_TURN_TEXT_MAX,
  turnTextForReader,
} from "../src/q/turn-reader.js";

/**
 * Owner 2026-10-30: the answer to "What should I do today?" closes with
 * Q's offer to build a full plan. A "yes" after it means something only
 * when the reader sees that offer, so a long turn keeps its close.
 */
describe("a recent turn as the turn reader sees it", () => {
  it("is whole when short", () => {
    expect(turnTextForReader("Want me to build it?")).toBe(
      "Want me to build it?",
    );
  });

  it("keeps its opening and its closing offer when long, within the budget", () => {
    const offer =
      "If you'd like a full plan for the weeks ahead, say so and I'll build it.";
    const long = `What to do next for your raise, most important first: ${"1. Upload your deck and the latest figures. ".repeat(20)}${offer}`;
    const seen = turnTextForReader(long);
    expect(seen.length).toBeLessThanOrEqual(TURN_READER_TURN_TEXT_MAX);
    expect(seen.startsWith("What to do next for your raise")).toBe(true);
    expect(seen.endsWith(offer)).toBe(true);
  });
});
