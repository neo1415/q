import { describe, expect, it } from "vitest";

import {
  afterAlreadySaid,
  coalescedSegments,
  holdingLineFor,
  LIVE_HOLDING_LINES,
  withoutHoldingLines,
} from "../src/voice/live/broker.js";

/**
 * VOICE-FIX: the owner's live voice session (20 Nov 2026, voice 40e55b83)
 * repeated itself and stored holding lines as Q's words. Replayed here on
 * its own words, with no provider.
 */
describe("the rest of an answer is never said twice", () => {
  it("drops every sentence already said, even when the final words differ in form", () => {
    const sent =
      "The next step is to reply to Daniel, then decide whether to continue diligence or pause it.";
    const said =
      "The next step is to reply to Daniel, then decide whether to continue diligence or pause it. Evidence: Tensorgate is waiting for your reply, and three diligence requests remain unanswered.";
    expect(afterAlreadySaid(sent, said)).toBe(
      "Evidence: Tensorgate is waiting for your reply, and three diligence requests remain unanswered.",
    );
    // Curly quotes and spacing changed after the start was handed over.
    expect(
      afterAlreadySaid(
        "You’re on your relationship with Tensorgate.",
        "You're on your relationship with  Tensorgate. Before that, we opened Zino Aviation.",
      ),
    ).toBe("Before that, we opened Zino Aviation.");
  });

  it("keeps everything when nothing was said yet, and nothing when all was", () => {
    expect(afterAlreadySaid("", "One. Two.")).toBe("One. Two.");
    expect(afterAlreadySaid("One. Two.", "One. Two.")).toBe("");
  });
});

describe("holding lines are never Q's stored words", () => {
  it("strips a holding line the voice said in front of the answer", () => {
    expect(
      withoutHoldingLines(
        "Working on it. The next step is to reply to Daniel.",
      ),
    ).toBe("The next step is to reply to Daniel.");
    expect(withoutHoldingLines("Bear with me.")).toBe("");
    expect(withoutHoldingLines("Right, working on it.")).toBe("");
    expect(withoutHoldingLines("Looking into it. Here is what I found.")).toBe(
      "Here is what I found.",
    );
    // Only at the start: Q's own sentence that happens to match stays.
    expect(withoutHoldingLines("Here it is. On it.")).toBe(
      "Here it is. On it.",
    );
  });

  it("every holding line is stripped, and coalescing keeps them separable", () => {
    for (const line of LIVE_HOLDING_LINES) {
      expect(withoutHoldingLines(`${line} Done.`)).toBe("Done.");
    }
    const joined = coalescedSegments([
      { role: "Q", text: "On it.", at: 1, delegated: false },
      {
        role: "Q",
        text: "Then let's leave Tensorgate alone.",
        at: 2,
        delegated: false,
      },
    ]);
    expect(joined.map((s) => withoutHoldingLines(s.text))).toEqual([
      "Then let's leave Tensorgate alone.",
    ]);
  });

  it("one holding line at a time, never the same words twice in a row", () => {
    let last: string | null = null;
    for (let i = 0; i < 8; i += 1) {
      const line = holdingLineFor(i, last);
      expect(line).not.toBe(last);
      last = line;
    }
  });
});
