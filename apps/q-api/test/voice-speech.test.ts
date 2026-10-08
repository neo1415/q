import { describe, expect, it } from "vitest";

import {
  bounded,
  bySentence,
  sentences,
  SPOKEN_MAX_CHARS,
  SPOKEN_TABLE,
  speakable,
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
      "What I found\nPaystack raised a Series A.\nSee the announcement and example.com.\nquoted\ncode and emphasis.",
    );
  });

  it("says a bare address as its domain, never dropping it (lead 2026-10-03)", () => {
    expect(
      speakable(
        "Approved: Update your company profile. Website: https://www.withnixo.com/about. It's being applied now.",
      ),
    ).toBe(
      "Approved: Update your company profile. Website: withnixo.com. It's being applied now.",
    );
    expect(speakable("Website: https://thevaultlyne.com")).toBe(
      "Website: thevaultlyne.com",
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

  it("never cuts mid-sentence, even when the room is small (founder live 2026-10-07)", () => {
    const rest =
      "Termly and the five additional companies are not individually identified. More follows here.";
    expect(bounded(rest, 30)).toBe("The rest is on your screen.");
    expect(bounded(rest, 80)).toBe(
      "Termly and the five additional companies are not individually identified. The rest is on your screen.",
    );
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

describe("natural delivery (RECOVERY A10, audit C-17)", () => {
  it("says a numbered list as first, second, third, each item its own sentence", () => {
    expect(
      speakable(
        "Three fit:\n1. Halyard Security\n2. Clearwater Assurance\n3. Tensorgate",
      ),
    ).toBe(
      "Three fit:\nFirst, Halyard Security.\nSecond, Clearwater Assurance.\nThird, Tensorgate.",
    );
  });

  it("closes bullet items so they never run together", () => {
    expect(speakable("- Halyard\n- Clearwater")).toBe("Halyard.\nClearwater.");
  });

  it("points at the screen for a table instead of falling silent (audit C3)", () => {
    const table = "| Investor | Fit |\n| --- | --- |\n| Halyard | 8.8 |";
    expect(speakable(table)).toBe(SPOKEN_TABLE);
    expect(speakable(`Here they are.\n${table}\nWant more?`)).toBe(
      `Here they are.\n${SPOKEN_TABLE}\nWant more?`,
    );
  });
});
