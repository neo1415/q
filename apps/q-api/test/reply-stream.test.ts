import { describe, expect, it } from "vitest";

import { createReplySentenceStream } from "../src/voice/reply-stream.js";

/**
 * P0-3: the final reply as sentences while it is written. Properties over
 * random chunkings of the model's JSON: every sentence is said exactly
 * once, in order, and together they are the settled reply.
 */

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function chunk(text: string, random: () => number): string[] {
  const parts: string[] = [];
  let at = 0;
  while (at < text.length) {
    const size = 1 + Math.floor(random() * 9);
    parts.push(text.slice(at, at + size));
    at += size;
  }
  return parts;
}

const REPLIES = [
  "Typical cheque noted at €25,000. Which stages do you back?",
  'You said "never gambling." Done! What else would you rather not see?',
  "Recorded.",
  "Line one\nline two. And a tab\there? Yes.",
  "Unicode é works. Café too.",
];

describe("P0-3 · the reply streams as sentences", () => {
  it("says each sentence once, in order, whatever the chunking", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = rng(seed);
      const reply = REPLIES[seed % REPLIES.length] ?? "";
      const json = JSON.stringify({ reply, asking: "I2.stages" });
      const said: string[] = [];
      const stream = createReplySentenceStream((s) => said.push(s));
      for (const part of chunk(json, random)) stream.push(part);
      const { diverged } = stream.finish(reply);
      expect(diverged).toBe(false);
      expect(said.join(" ").replace(/\s+/g, " ")).toBe(
        reply.replace(/\s+/g, " ").trim(),
      );
      expect(said.every((s) => s.length > 0 && s === s.trim())).toBe(true);
    }
  });

  it("speaks before the object is complete", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((s) => said.push(s));
    stream.push('{"reply": "First sentence. Second');
    expect(said).toEqual(["First sentence."]);
    stream.push(' sentence.", "asking": null}');
    stream.finish("First sentence. Second sentence.");
    expect(said).toEqual(["First sentence.", "Second sentence."]);
  });

  it("reports a settled reply that differs from what was streamed, and says nothing more", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((s) => said.push(s));
    stream.push('{"reply": "One thing. ');
    const { diverged } = stream.finish("Something else entirely.");
    expect(diverged).toBe(true);
    expect(said).toEqual(["One thing."]);
  });

  it("with nothing streamed, says the whole settled reply", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((s) => said.push(s));
    stream.finish("A. B? C!");
    expect(said).toEqual(["A.", "B?", "C!"]);
  });
});
