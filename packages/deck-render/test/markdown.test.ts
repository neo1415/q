import { describe, expect, it } from "vitest";

import { inlineRuns, plainMarkdown, printBlocks } from "../src/index.js";

describe("the writers' markdown, read for print (live 2026-10-31)", () => {
  it("splits bold from plain, and drops an unclosed marker", () => {
    expect(inlineRuns("**Stage:** Apparent fit")).toEqual([
      { text: "Stage:", bold: true },
      { text: " Apparent fit", bold: false },
    ]);
    expect(inlineRuns("half **open")).toEqual([
      { text: "half open", bold: false },
    ]);
    expect(inlineRuns("a [link](https://x.test) and `code` and *it*")).toEqual(
      [{ text: "a link and code and it", bold: false }],
    );
  });

  it("reads headings, bullets, numbers, tables and paragraphs", () => {
    const blocks = printBlocks(
      "## Fit\nOne line\ncontinued.\n\n- a\n  - b\n3. c\n| x | y |\n|---|---|\n| 1 | 2 |",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "item",
      "item",
      "item",
      "item",
      "item",
    ]);
    expect(blocks[1]).toMatchObject({
      runs: [{ text: "One line continued.", bold: false }],
    });
    expect(blocks[3]).toMatchObject({ depth: 1, marker: "•" });
    expect(blocks[4]).toMatchObject({ marker: "3." });
    expect(blocks[6]).toMatchObject({ runs: [{ text: "1 · 2" }] });
  });

  it("a quoted review point loses the quote's list marker and bold", () => {
    expect(
      plainMarkdown(
        'Summary: 2 figures without a basis, e.g. "- **Cheque and role:** Potential fit…"',
      ),
    ).toBe('Summary: 2 figures without a basis, e.g. "Cheque and role: Potential fit…"');
    expect(plainMarkdown("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
  });
});
