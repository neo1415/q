import { describe, expect, it } from "vitest";

import {
  bounded,
  bySentence,
  sentences,
  SPOKEN_MAX_CHARS,
  speakable,
  withFiller,
} from "../src/voice/speech.js";

/**
 * Text as Q speaks it (CQ-Q-VOICE-001 C §39, D §57, §66): plain sentences,
 * no markup, no addresses, no source markers, bounded, and chunked so an
 * interruption loses at most one sentence.
 */

describe("speakable", () => {
  it("drops markdown structure, links, citations and source markers", () => {
    const text = [
      "## What I found",
      "- **Paystack** raised a Series A (public web source S1).",
      "- See [the announcement](https://example.com/news) and https://example.com/more [2].",
      "| a | b |",
      "> quoted",
      "`code` and *emphasis*.",
    ].join("\n");
    expect(speakable(text)).toBe(
      "What I found\nPaystack raised a Series A.\nSee the announcement and.\nquoted\ncode and emphasis.",
    );
  });
});

describe("bounded", () => {
  it("cuts a long answer at a sentence and says the rest is on screen", () => {
    const long = `${"This is a sentence. ".repeat(100)}`.trim();
    const spoken = bounded(long);
    expect(spoken.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS + 40);
    expect(spoken.endsWith("The rest is on your screen.")).toBe(true);
    expect(spoken).not.toContain("sentence. This is a sent The rest");
    expect(bounded("Short.")).toBe("Short.");
  });
});

describe("sentences", () => {
  it("splits on sentence ends and keeps figures together", () => {
    expect(
      sentences("We raised $1.5m. Growth was 40%! Next round in Q2? Yes."),
    ).toEqual([
      "We raised $1.5m.",
      "Growth was 40%!",
      "Next round in Q2?",
      "Yes.",
    ]);
  });
});

async function* deltas(
  parts: readonly string[],
  onEach?: (index: number) => void,
): AsyncGenerator<string> {
  for (const [index, part] of parts.entries()) {
    onEach?.(index);
    yield part;
    await Promise.resolve();
  }
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe("bySentence", () => {
  it("yields each sentence as soon as it is complete and flushes the remainder", async () => {
    const spoken = await collect(
      bySentence(
        deltas(["Noted. Your ", "role is CEO. What", " is the team size"]),
      ),
    );
    expect(spoken).toEqual([
      "Noted.",
      "Your role is CEO.",
      "What is the team size",
    ]);
  });

  it("stops at the abort and never yields what came after (§38)", async () => {
    const controller = new AbortController();
    const spoken = await collect(
      bySentence(
        deltas(["First sentence. ", "Second sentence. ", "Third."], (index) => {
          if (index === 2) {
            controller.abort();
          }
        }),
        controller.signal,
      ),
    );
    expect(spoken).toEqual(["First sentence."]);
  });
});

describe("withFiller (D §53)", () => {
  async function* slow(parts: readonly string[], gate: Promise<void>) {
    await gate;
    for (const part of parts) {
      yield part;
    }
  }

  it("says nothing extra when the answer is quick", async () => {
    const spoken = await collect(
      withFiller(deltas(["Seed."]), {
        filler: "Let me check that.",
        afterMs: 2_500,
        setTimeout: () => 0 as never,
        clearTimeout: () => undefined,
      }),
    );
    expect(spoken).toEqual(["Seed."]);
  });

  it("says one filler when the first words take too long, then the answer", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fire: () => void = () => undefined;
    const spoken = collect(
      withFiller(slow(["Seed rounds run from $500k."], gate), {
        filler: "Let me check that.",
        afterMs: 2_500,
        setTimeout: ((callback: () => void) => {
          fire = callback;
          return 1 as never;
        }) as never,
        clearTimeout: () => undefined,
      }),
    );
    fire();
    await Promise.resolve();
    release();
    expect(await spoken).toEqual([
      "Let me check that.",
      "Seed rounds run from $500k.",
    ]);
  });
});
