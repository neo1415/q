import { describe, expect, it } from "vitest";

import { createLiveReply } from "../src/voice/live-reply.js";
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

/**
 * Production 2026-11-07 (e2e run 3): the stored turn said "I've saved…"
 * once, but the think stream the speech provider speaks carried it twice:
 * the receipt code said first, then the whole settled reply, which opens
 * with that receipt. The settled reply replaces what was streamed; it is
 * never appended to it. What the provider receives is what the person
 * hears, so these read the stream as the provider does.
 */
describe("a lead said first is heard once", () => {
  const RECEIPT =
    "Great, I've saved Paying customers (early signal) and 40 (paying customers).";
  const QUESTION = "How many founders are there?";

  /** The voice path end to end: stream → speaker queue → remainder. */
  async function heardThroughSpeaker(
    run: (stream: ReturnType<typeof createReplySentenceStream>) => string,
  ): Promise<string> {
    const live = createLiveReply();
    const stream = createReplySentenceStream((sentence) => live.push(sentence));
    const settled = run(stream);
    live.close();
    const spoken: string[] = [];
    for await (const part of live.spoken) spoken.push(part);
    const remainder = live.remainderOf(settled);
    return [...spoken, remainder].join(" ").trim();
  }

  it("the model's text did not stream: the lead, then only what follows it", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((sentence) => said.push(sentence));
    stream.lead(RECEIPT);
    expect(stream.finish(`${RECEIPT} ${QUESTION}`)).toEqual({
      diverged: false,
    });
    expect(said).toEqual([RECEIPT, QUESTION]);
  });

  it("the model's text streamed after the lead: each sentence once", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((sentence) => said.push(sentence));
    stream.lead(RECEIPT);
    for (const part of chunk(
      JSON.stringify({ reply: `Thanks. ${QUESTION}` }),
      rng(7),
    )) {
      stream.push(part);
    }
    expect(stream.finish(`${RECEIPT} Thanks. ${QUESTION}`)).toEqual({
      diverged: false,
    });
    expect(said).toEqual([RECEIPT, "Thanks.", QUESTION]);
  });

  it("a model sentence restating the lead is never said", () => {
    const said: string[] = [];
    const stream = createReplySentenceStream((sentence) => said.push(sentence));
    stream.lead(RECEIPT, (sentence) => /I've saved/u.test(sentence));
    for (const part of chunk(
      JSON.stringify({
        reply: `Noted, I've saved Paying customers (early signal). ${QUESTION}`,
      }),
      rng(11),
    )) {
      stream.push(part);
    }
    stream.finish(`${RECEIPT} ${QUESTION}`);
    expect(said).toEqual([RECEIPT, QUESTION]);
  });

  it("what the speech provider is sent holds the receipt once", async () => {
    const heard = await heardThroughSpeaker((stream) => {
      stream.lead(RECEIPT);
      const settled = `${RECEIPT} ${QUESTION}`;
      stream.finish(settled);
      return settled;
    });
    expect(heard.match(/I've saved/gu) ?? []).toHaveLength(1);
    expect(heard).toBe(`${RECEIPT} ${QUESTION}`);
  });
});
