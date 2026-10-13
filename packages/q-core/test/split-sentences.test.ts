import { describe, expect, it } from "vitest";

import { splitSentences } from "../src/index.js";

/** D9: a stop between digits, in a version or a URL is not a sentence end. */
describe("splitSentences", () => {
  it("never cuts a decimal, a version or a URL, and loses nothing", () => {
    const text =
      "Portfolio-at-risk of 3.8% in March. Fit is 8.8/10 on v2.1 at capitalq.com/x. Revenue grew.";
    const parts = splitSentences(text);
    expect(parts.join("")).toBe(text);
    expect(parts.map((part) => part.trim())).toEqual([
      "Portfolio-at-risk of 3.8% in March.",
      "Fit is 8.8/10 on v2.1 at capitalq.com/x.",
      "Revenue grew.",
    ]);
  });

  it("keeps paragraph breaks inside the pieces", () => {
    const text = "One.\n\nTwo is next. Three";
    expect(splitSentences(text).join("")).toBe(text);
    expect(splitSentences(text)).toHaveLength(3);
  });
});
