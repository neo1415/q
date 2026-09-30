import { describe, expect, it } from "vitest";

import { figureStatedIn, textStatedIn } from "../src/voice/value-support.js";

/**
 * Unknown stays unknown (ACC 2026-09-25): a STATED value must be one its
 * quote gives. Properties over generated figures and phrasings; no
 * assertion depends on any particular wording.
 */

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Ways a person writes the same figure, by its thousands. */
const FORMS: readonly ((thousands: number) => string)[] = [
  (k) => `${String(k)}k`,
  (k) => `$${(k * 1000).toLocaleString("en-US")}`,
  (k) => `${String(k)} thousand`,
  (k) => `${String(k * 1000)}`,
  (k) => `€${(k * 1000).toLocaleString("de-DE")}`,
  (k) => `${String(k)},000.00`,
];

describe("a figure is recorded only when the quote states it", () => {
  it("the ends of a stated range are stated; a point worked out inside it is not", () => {
    const random = rng(7);
    for (let i = 0; i < 400; i += 1) {
      const low = 5 + Math.floor(random() * 95);
      const high = low + 10 + Math.floor(random() * 400);
      const form = FORMS[i % FORMS.length] ?? FORMS[0];
      if (form === undefined) throw new Error("forms");
      const quote = `cheques from ${form(low)} to ${form(high)}`;
      expect(figureStatedIn(String(low * 1000), quote), quote).toBe(true);
      expect(figureStatedIn(String(high * 1000), quote), quote).toBe(true);
      const mid = ((low + high) * 1000) / 2;
      const midDigits = String(mid).replace(/0+$/, "");
      const endDigits = [low, high].map((n) =>
        String(n * 1000).replace(/0+$/, ""),
      );
      if (!endDigits.includes(midDigits)) {
        expect(
          figureStatedIn(String(mid), quote),
          `${quote} ~ ${String(mid)}`,
        ).toBe(false);
      }
    }
  });

  it("a quote with no figure in digits cannot state one", () => {
    expect(
      figureStatedIn("50000", "what's a typical cheque at pre-seed?"),
    ).toBe(null);
    expect(figureStatedIn("62500", "cheques from 25 to 100 thousand")).toBe(
      false,
    );
  });
});

describe("free text is recorded only in the person's own words", () => {
  it("any span of their words, in any case or punctuation, is theirs", () => {
    const quote = "I'm a Partner there — at Harrow Road Capital, since 2019.";
    const words = quote.split(/\s+/);
    for (let from = 0; from < words.length; from += 1) {
      for (let to = from + 1; to <= words.length; to += 1) {
        const span = words.slice(from, to).join(" ");
        if (!/[\p{L}\p{N}]/u.test(span)) continue;
        expect(textStatedIn(span.toUpperCase(), quote), span).toBe(true);
      }
    }
  });

  it("a restatement or another step's answer is not their words", () => {
    expect(
      textStatedIn(
        "Angel investor",
        "I'm an angel, I invest personally through Harrow Road Capital",
      ),
    ).toBe(false);
    expect(textStatedIn("Managing Partner", "I'm a partner there")).toBe(false);
    expect(textStatedIn("part", "I'm a partner there")).toBe(false);
    expect(textStatedIn("", "anything")).toBe(false);
  });
});

describe("a figure said in words is a figure stated (live 2026-09-30)", () => {
  it("reads the figure the words give, and only that figure", () => {
    expect(figureStatedIn("1", "There's only one founder.")).toBe(true);
    expect(figureStatedIn("12", "Correct me if I'm on twelve.")).toBe(true);
    expect(
      figureStatedIn(
        "5000000",
        "We're looking for about five million dollars.",
      ),
    ).toBe(true);
    expect(
      figureStatedIn("62500", "cheques from twenty five to a hundred thousand"),
    ).toBe(false);
    expect(
      figureStatedIn("3", "We're looking for about five million dollars."),
    ).toBe(false);
    expect(figureStatedIn("1", "we are backed by Y Combinator")).toBe(null);
  });
});

describe("a half said in words (live 2026-09-30)", () => {
  it("reads 'four and a half million' as 4,500,000", () => {
    expect(
      figureStatedIn("4500000", "make that four and a half million, not five"),
    ).toBe(true);
    expect(
      figureStatedIn("4000000", "make that four and a half million, not five"),
    ).toBe(false);
  });
});

describe("a scale with an article (live 2026-09-30)", () => {
  it("reads 'north of a thousand people' as 1,000", () => {
    expect(figureStatedIn("1000", "Team is north of a thousand people.")).toBe(
      true,
    );
  });
});
