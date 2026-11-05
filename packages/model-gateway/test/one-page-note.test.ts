import { describe, expect, it } from "vitest";

import {
  environmentNoteParts,
  ONE_PAGE_NOTE,
  WRITING_DOCUMENT_NOTE,
} from "../src/q/index.js";

/**
 * live6 2026-11-04 (production 7b9a267ce): "Write me a one-page memo on
 * Ledgerline" was written at 440 words in seven sections, printed on two
 * pages, and ended "The memo text is ready for review."
 */
describe("a one-page document is written to one page's budget", () => {
  it("the writer is given the budget only when one page was asked for", () => {
    const onePage = JSON.stringify(
      environmentNoteParts([], [], [], {
        writingDocument: true,
        onePage: true,
      }),
    );
    const document = JSON.stringify(
      environmentNoteParts([], [], [], { writingDocument: true }),
    );
    expect(onePage).toContain("ONE PAGE");
    expect(document).not.toContain("ONE PAGE");
    expect(ONE_PAGE_NOTE).toMatch(/under 280 words/u);
  });

  it("the writer never closes the document with a line about itself", () => {
    expect(WRITING_DOCUMENT_NOTE).toMatch(
      /never end with a line about the document itself/u,
    );
  });
});
