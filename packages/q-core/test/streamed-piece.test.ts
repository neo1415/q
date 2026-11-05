import { describe, expect, it } from "vitest";

import { createSentenceCutter, streamedPiece } from "../src/index.js";

/**
 * live6 2026-11-04 (production 7b9a267ce): the memo streamed as
 * "...break-even date. ## Key Gaps and Risks" -- a heading glued to the
 * sentence before it. Streamed pieces keep the answer's blocks.
 */
describe("streamedPiece: a heading or list item keeps its own line", () => {
  it("rebuilds a memo's headings from the cutter's sentences", () => {
    const memo =
      "# Ledgerline memo\n\n## Overview\nLedgerline sells VAT software. It is in Lagos.\n\n## Key Gaps and Risks\n- Customer count needs reconciling.\n- Runway is unclear.\n\nNext, ask for cohorts.";
    const cutter = createSentenceCutter();
    const pieces = [...cutter.push(memo), cutter.rest() ?? ""].filter(
      (piece) => piece.length > 0,
    );
    const streamed = pieces
      .map((piece, at) => streamedPiece(piece, at === 0))
      .join("");
    expect(streamed).toContain("in Lagos. \n\n## Key Gaps and Risks\n");
    expect(streamed).toContain("\n\n## Overview\n");
    expect(streamed).not.toMatch(/\. ##/u);
    expect(streamed.startsWith("# Ledgerline memo")).toBe(true);
  });

  it("an ordinary sentence follows with a space", () => {
    expect(streamedPiece("It is in Lagos.", false)).toBe("It is in Lagos. ");
    expect(streamedPiece("## Overview", true)).toBe("## Overview ");
  });
});
