import { describe, expect, it } from "vitest";

import { researchLead } from "../src/q/early-lead.js";

/**
 * Owner 2026-10-21 (time to the first word): what Q is doing as a web
 * search starts. F-45 (QA 2026-10-23): a question about one company is no
 * longer opened with a fixed line of its declared stage and place; the
 * answer's own first sentence leads. Nothing is said for its own sake.
 */
describe("first-word leads", () => {
  it("names what is being looked up on the web, or says it plainly", () => {
    expect(researchLead("Northwind Ledger")).toBe(
      "I'm checking what's public on Northwind Ledger now.",
    );
    expect(researchLead(null)).toBe(
      "I'm checking the public web for that now.",
    );
  });
});
