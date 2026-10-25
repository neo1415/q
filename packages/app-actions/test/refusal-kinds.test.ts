import { describe, expect, it } from "vitest";

import { isRefusal, refusal } from "../src/define.js";

/**
 * Guard run (2026-10-25, runs fafa6adf, 3b7da40d): a refusal's guidance for
 * Q ("give them the draft…") was said as the whole reply. Words for the
 * person and words for the model are two kinds of refusal.
 */
describe("a refusal says whom its words are for", () => {
  it("is the person's words by default, and guidance only when marked", () => {
    expect(refusal("You don't have a Q Card yet.")).toEqual({
      refused: "You don't have a Q Card yet.",
    });
    expect(refusal("Prepare it as a message.", { forModel: true })).toEqual({
      refused: "Prepare it as a message.",
      forModel: true,
    });
  });

  it("is recognised either way, and nothing else is", () => {
    expect(isRefusal(refusal("Why."))).toBe(true);
    expect(isRefusal(refusal("Do this.", { forModel: true }))).toBe(true);
    expect(isRefusal({ refused: "Why.", forModel: false })).toBe(false);
    expect(isRefusal({ refused: "Why.", other: 1 })).toBe(false);
  });
});
