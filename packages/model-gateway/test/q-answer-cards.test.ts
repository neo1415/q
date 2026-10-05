import { describe, expect, it } from "vitest";

import { QResultBlocksSchema } from "@capital-q/contracts";

import {
  answerCardFit,
  answerCardsBlock,
  type ModelAnswerCardsLike,
} from "../src/q/answer-cards.js";
import { analystResultBlocks } from "../src/q/result-blocks.js";

type Level = "STRONG" | "GOOD" | "PARTIAL" | "UNKNOWN";
const measures = (...levels: Level[]) =>
  levels.map((level, i) => ({
    label: `M${String(i)}`,
    level,
    value: level === "UNKNOWN" ? "Not shared yet" : "x",
  }));
const card = (name: string, levels: Level[]) => ({
  name,
  line: null,
  reasons: [`${name} reason`],
  measures: measures(...levels),
  view: null,
  said: `${name} is here.`,
  citations: ["F1", "F2", "F1"],
});

describe("answer card fit (ADR 0051)", () => {
  it("is the mean of known measures, to one decimal", () => {
    expect(answerCardFit(measures("STRONG", "GOOD", "PARTIAL"))).toEqual({
      score: 7.2,
      measured: 3,
      of: 3,
    });
  });

  it("leaves an unknown measure out instead of scoring it zero", () => {
    const fit = answerCardFit(
      measures("STRONG", "STRONG", "STRONG", "UNKNOWN"),
    );
    expect(fit).toEqual({ score: 10, measured: 3, of: 4 });
  });

  it("gives no fit when too little is known", () => {
    expect(answerCardFit(measures("STRONG", "UNKNOWN", "UNKNOWN"))).toBeNull();
  });
});

describe("answer cards block", () => {
  const ranked: ModelAnswerCardsLike = {
    shape: "RANKED",
    title: "Top three for your mandate",
    cards: [
      card("Atlas Ledger", ["GOOD", "PARTIAL", "UNKNOWN", "GOOD"]),
      card("Norrland Grid", ["STRONG", "STRONG", "GOOD", "UNKNOWN"]),
      card("Kestrel Heat", ["STRONG", "GOOD", "STRONG", "GOOD"]),
    ],
    followUps: ["Compare side by side"],
  };

  it("orders a ranked answer by fit in code and colours by final order", () => {
    const block = answerCardsBlock(ranked);
    expect(block?.cards.map((c) => c.name)).toEqual([
      "Norrland Grid",
      "Kestrel Heat",
      "Atlas Ledger",
    ]);
    expect(block?.cards.map((c) => c.hue)).toEqual([1, 2, 3]);
    expect(block?.cards[0]?.fit).toEqual({ score: 9.2, measured: 3, of: 4 });
    expect(block?.cards[0]?.sourceCount).toBe(2);
    expect(block?.cards[0]?.key).toBe("norrland-grid");
  });

  it("keeps a side-by-side comparison in the order asked", () => {
    const block = answerCardsBlock({ ...ranked, shape: "SIDE_BY_SIDE" });
    expect(block?.cards.map((c) => c.name)[0]).toBe("Atlas Ledger");
  });

  it("gives research no fit and no measures", () => {
    const block = answerCardsBlock({ ...ranked, shape: "RESEARCH" });
    expect(
      block?.cards.every((c) => c.fit === null && c.measures.length === 0),
    ).toBe(true);
  });

  it("leads the analyst's blocks and replaces v12 comparison cards", () => {
    const blocks = analystResultBlocks({
      result: {
        answer: "Three stand out.",
        answerCards: ranked,
        comparisonCards: {
          title: null,
          items: [
            { name: "A", subtitle: null, points: ["a"] },
            { name: "B", subtitle: null, points: ["b"] },
          ],
        },
      } as Parameters<typeof analystResultBlocks>[0]["result"],
      subjects: [],
    });
    expect(blocks?.[0]?.kind).toBe("ANSWER_CARDS");
    expect(blocks?.some((b) => b.kind === "COMPARISON_CARDS")).toBe(false);
    expect(QResultBlocksSchema.safeParse(blocks).success).toBe(true);
  });
});
