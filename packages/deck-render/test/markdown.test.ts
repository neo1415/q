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
    expect(inlineRuns("a [link](https://x.test) and `code` and *it*")).toEqual([
      { text: "a link and code and it", bold: false },
    ]);
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
      "table",
    ]);
    expect(blocks[1]).toMatchObject({
      runs: [{ text: "One line continued.", bold: false }],
    });
    expect(blocks[3]).toMatchObject({ depth: 1, marker: "•" });
    expect(blocks[4]).toMatchObject({ marker: "3." });
    expect(blocks[5]).toMatchObject({
      kind: "table",
      header: [[{ text: "x" }], [{ text: "y" }]],
      rows: [[[{ text: "1" }], [{ text: "2" }]]],
    });
  });

  it("reads the writers' plain pipe table (live 2026-10-31 IC memo)", () => {
    const blocks = printBlocks(
      [
        "The categories are internal teams.",
        "Name | What they offer | Where | Price or scale | Source",
        "Cylera | Healthcare IoT asset intelligence and security | Not established in the available research | Not provided | [S7]",
        "Intraprise Health | Named by CB Insights as a Clearwater alternative; offering not established | Not established | Not provided | [S7]",
        "Kroll Cyber Risk | Cyber-risk preparedness | Not established | Over 3,000 incidents per year stated in source | [S25]",
        "",
        "After the table.",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "table",
      "paragraph",
    ]);
    const table = blocks[1];
    if (table?.kind !== "table") throw new Error("no table");
    expect(table.header).toHaveLength(5);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2]?.[3]).toEqual([
      { text: "Over 3,000 incidents per year stated in source", bold: false },
    ]);
    expect(plainMarkdown("Name | Role\nAda | CEO")).toBe(
      "Name · Role Ada · CEO",
    );
    // A stray pipe in prose stays prose.
    expect(printBlocks("Revenue | burn is unclear.\nNext line.")[0]?.kind).toBe(
      "paragraph",
    );
  });

  it("a quoted review point loses the quote's list marker and bold", () => {
    expect(
      plainMarkdown(
        'Summary: 2 figures without a basis, e.g. "- **Cheque and role:** Potential fit…"',
      ),
    ).toBe(
      'Summary: 2 figures without a basis, e.g. "Cheque and role: Potential fit…"',
    );
    expect(plainMarkdown("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
  });
});
