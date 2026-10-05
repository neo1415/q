import { describe, expect, it } from "vitest";

import { QAnswerCardsBlockSchema } from "../src/index.js";

const card = (
  key: string,
  fit: { score: number; measured: number; of: number } | null,
) => ({
  key,
  name: key,
  line: null,
  hue: 1,
  fit,
  reasons: ["why"],
  measures: [],
  view: null,
  said: null,
  sourceCount: 0,
  subject: null,
});

describe("ANSWER_CARDS (ADR 0051)", () => {
  it("accepts one to ten cards", () => {
    const ok = (n: number) =>
      QAnswerCardsBlockSchema.safeParse({
        kind: "ANSWER_CARDS",
        shape: "RANKED",
        title: "Top",
        cards: Array.from({ length: n }, (_, i) => card(`c${String(i)}`, null)),
        followUps: [],
      }).success;
    expect([ok(0), ok(1), ok(10), ok(11)]).toEqual([false, true, true, false]);
  });

  it("refuses duplicate keys, a fit on research, and measured above of", () => {
    const base = { kind: "ANSWER_CARDS", title: "T", followUps: [] };
    expect(
      QAnswerCardsBlockSchema.safeParse({
        ...base,
        shape: "RANKED",
        cards: [card("a", null), card("a", null)],
      }).success,
    ).toBe(false);
    expect(
      QAnswerCardsBlockSchema.safeParse({
        ...base,
        shape: "RESEARCH",
        cards: [card("a", { score: 5, measured: 3, of: 3 })],
      }).success,
    ).toBe(false);
    expect(
      QAnswerCardsBlockSchema.safeParse({
        ...base,
        shape: "RANKED",
        cards: [card("a", { score: 5, measured: 4, of: 3 })],
      }).success,
    ).toBe(false);
  });
});
