import { describe, expect, it } from "vitest";

import {
  MIN_CHARACTERS_PER_PLACE,
  selectReadingPassages,
  type ReadableChunk,
} from "../src/index.js";

const leaf = (
  chunkIndex: number,
  content: string,
  locator: ReadableChunk["locator"],
): ReadableChunk => ({ role: "LEAF", chunkIndex, content, locator });

describe("selectReadingPassages · the whole document, once", () => {
  it("drops PARENT chunks so no text is read twice", () => {
    const chunks: ReadableChunk[] = [
      { role: "PARENT", chunkIndex: 0, content: "A B", locator: { slide: 1 } },
      leaf(1, "A", { slide: 1 }),
      leaf(2, "B", { slide: 1 }),
    ];
    const read = selectReadingPassages(chunks, { maxCharacters: 1_000 });
    expect(read.passages.map((p) => p.content)).toEqual(["A", "B"]);
    expect(read.sampled).toBe(false);
  });

  it("gives every page a fair share when the text exceeds the budget", () => {
    const chunks = Array.from({ length: 20 }, (_u, at) =>
      leaf(at, `${String(at + 1)} ${"word ".repeat(400)}`, {
        pageStart: at + 1,
      }),
    );
    const read = selectReadingPassages(chunks, { maxCharacters: 20_000 });
    expect(read.sampled).toBe(true);
    expect(read.placesRead).toBe(20);
    const total = read.passages.reduce((n, p) => n + p.content.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
    // The last page is read, not cut off.
    expect(read.passages.at(-1)?.locator.pageStart).toBe(20);
    for (const passage of read.passages) {
      expect(passage.content.length).toBeLessThanOrEqual(1_000);
    }
  });

  it("hands a short slide's unused share to the long ones", () => {
    const chunks = [
      leaf(0, "Title", { slide: 1 }),
      leaf(1, "x".repeat(5_000), { slide: 2 }),
    ];
    const read = selectReadingPassages(chunks, { maxCharacters: 3_000 });
    expect(read.passages[0]?.content).toBe("Title");
    expect(read.passages[1]?.content.length).toBe(3_000 - "Title".length);
  });

  it("samples places at an even stride, first and last included, when there are too many", () => {
    const chunks = Array.from({ length: 300 }, (_u, at) =>
      leaf(at, `page ${String(at + 1)} ${"y".repeat(900)}`, {
        pageStart: at + 1,
      }),
    );
    const budget = 30_000;
    const read = selectReadingPassages(chunks, { maxCharacters: budget });
    expect(read.placesTotal).toBe(300);
    expect(read.placesRead).toBe(Math.floor(budget / MIN_CHARACTERS_PER_PLACE));
    const pages = read.passages.map((p) => p.locator.pageStart);
    expect(pages[0]).toBe(1);
    expect(pages.at(-1)).toBe(300);
  });

  it("is deterministic", () => {
    const chunks = Array.from({ length: 50 }, (_u, at) =>
      leaf(at, "z ".repeat(800), { slide: at + 1 }),
    );
    expect(selectReadingPassages(chunks, { maxCharacters: 9_000 })).toEqual(
      selectReadingPassages(chunks, { maxCharacters: 9_000 }),
    );
  });
});
