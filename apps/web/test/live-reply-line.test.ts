import { describe, expect, it } from "vitest";

import {
  createReplyLine,
  type ReplyTranscript,
} from "../src/features/voice/live/reply-line";

/**
 * Owner report 2026-11-04: Q's reply on the live line was shown, stored and
 * mirrored into Chat as one row per audio chunk, split mid-word
 * ("Tensorg" / "ate"). The reply used to end each time the player's level
 * dipped between chunks. These are the deltas and dips of that reply.
 */

function harness() {
  const lines: ReplyTranscript[] = [];
  const kept: string[] = [];
  let pending: (() => void) | null = null;
  const line = createReplyLine({
    onTranscript: (one) => lines.push(one),
    keep: (text) => kept.push(text),
    settleMs: 1_200,
    setTimer: (run) => {
      pending = run;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  const settle = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return { line, lines, kept, settle };
}

// Real boundaries: deltas carry their own spacing, and one word is split.
const DELTAS = [
  "I don't have a task from",
  " you yet.",
  " What",
  " do you want me",
  " to take on",
  " —",
  " Tensorg",
  "ate",
  " or one of the",
  " others?",
];
const SAID =
  "I don't have a task from you yet. What do you want me to take on — Tensorgate or one of the others?";

describe("Q's reply on the live line", () => {
  it("stays one line and one stored segment across audio dips, words whole", () => {
    const { line, lines, kept } = harness();
    for (const delta of DELTAS) {
      line.speaking(true);
      line.delta(delta);
      // The player dips between chunks: not the end of the reply.
      line.speaking(false);
    }
    expect(new Set(lines.map((one) => one.key))).toEqual(new Set(["live_q1"]));
    expect(lines.at(-1)?.text).toBe(SAID);
    expect(kept).toEqual([]);
  });

  it("ends once Q has been quiet with no new words, kept once", () => {
    const { line, lines, kept, settle } = harness();
    for (const delta of DELTAS) {
      line.speaking(true);
      line.delta(delta);
      line.speaking(false);
    }
    settle();
    expect(kept).toEqual([SAID]);
    expect(lines.at(-1)).toEqual({
      key: "live_q1",
      role: "q",
      text: SAID,
      final: true,
    });
    // The next reply is a new line.
    line.delta("Sure.");
    expect(lines.at(-1)?.key).toBe("live_q2");
  });

  it("a dip followed by more audio does not end the reply", () => {
    const { line, kept } = harness();
    line.delta("First half,");
    line.speaking(true);
    line.speaking(false);
    line.speaking(true);
    line.delta(" second half.");
    expect(line.open()).toBe(true);
    expect(kept).toEqual([]);
  });

  it("keeps what was said when the person speaks over Q or the call ends", () => {
    const { line, kept } = harness();
    line.delta("I was saying");
    line.interrupted();
    line.delta("Another");
    line.end();
    expect(kept).toEqual(["I was saying", "Another"]);
    expect(line.open()).toBe(false);
  });
});
