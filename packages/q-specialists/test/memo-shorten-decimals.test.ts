import { describe, expect, it } from "vitest";

import { QArtifactContentSchema } from "@capital-q/contracts";

import { applyFixes } from "../src/index.js";

/**
 * D9 (production 2026-10-12): a revised memo read "portfolio-at-risk of
 * 3. 8%" where its input said "3.8%". Shortening a section cut at every
 * stop and re-spaced what it kept.
 */
describe("shortening a memo section", () => {
  it("never splits a decimal and never re-spaces the text it keeps", () => {
    const traction =
      "6,400 active traders keep their books in the app; 2,150 have borrowed. Loan book of USD 410,000 outstanding in March 2026. Reported 30-day portfolio-at-risk of 3.8%. Monthly revenue around USD 38,000.";
    const filler = Array.from(
      { length: 40 },
      (_, at) => `Filler sentence number ${String(at)} has several more words.`,
    ).join(" ");
    const content = QArtifactContentSchema.parse({
      sections: [
        {
          heading: "Traction",
          body: `${traction} ${filler}`,
          findings: [],
        },
      ],
      gaps: [],
    });
    const out = applyFixes(
      content,
      [{ kind: "SHORTEN_SECTION", section: 0 }],
      [],
      "MEMO",
    );
    const body = out.sections[0]?.body ?? "";
    expect(body.startsWith(traction)).toBe(true);
    expect(body).toContain("3.8%");
    expect(body).not.toMatch(/\d\. \d/u);
    expect(body).not.toMatch(/ {2}/u);
    expect(body.length).toBeLessThan(content.sections[0]?.body.length ?? 0);
  });
});
