import { describe, expect, it } from "vitest";

import { parseQResultBlocks } from "@capital-q/contracts";

import {
  pageFigureConflictBlocks,
  pageFigureConflicts,
} from "../src/q/figure-conflicts.js";

/**
 * Audit 14 Nov, slice 2 (decision 92): two independent public reports that
 * give different figures for the same measure are shown side by side, both
 * kept; one publisher twice, or different fundraising concepts, are never a
 * conflict.
 */
const page = (excerpt: string, domain: string, subjectMatch = "MATCH") => ({
  domain,
  excerpt,
  subjectMatch,
});

describe("public reports that disagree with each other", () => {
  it("shows independent pages' different figures for one measure, unreconciled", () => {
    const conflicts = pageFigureConflicts([
      page(
        "Maji Loop's annual recurring revenue reached $2 million in 2026.",
        "techcabal.com",
      ),
      page(
        "Maji Loop's annual recurring revenue reached $3.5 million in 2026.",
        "ventureburn.com",
      ),
    ]);
    expect(conflicts).toHaveLength(1);
    const blocks = pageFigureConflictBlocks(conflicts);
    expect(parseQResultBlocks(blocks).blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "UNCERTAINTY",
      confidence: "CONFLICTING_EVIDENCE",
    });
    expect(JSON.stringify(blocks)).toContain("techcabal.com");
    expect(JSON.stringify(blocks)).toContain("ventureburn.com");
  });

  it("never a conflict: one publisher twice, an unmatched page, agreement, or sought against raised", () => {
    expect(
      pageFigureConflicts([
        page(
          "Maji Loop's annual recurring revenue reached $2 million in 2026.",
          "techcabal.com",
        ),
        page(
          "Maji Loop's annual recurring revenue reached $3.5 million in 2026.",
          "news.techcabal.com",
        ),
      ]),
    ).toEqual([]);
    expect(
      pageFigureConflicts([
        page(
          "Maji Loop's annual recurring revenue reached $2 million in 2026.",
          "techcabal.com",
        ),
        page(
          "Maji Loop's annual recurring revenue reached $3.5 million in 2026.",
          "b.com",
          "POSSIBLE",
        ),
      ]),
    ).toEqual([]);
    expect(
      pageFigureConflicts([
        page(
          "Maji Loop's annual recurring revenue reached $2 million in 2026.",
          "techcabal.com",
        ),
        page(
          "Maji Loop's annual recurring revenue reached $2.02 million in 2026.",
          "b.com",
        ),
      ]),
    ).toEqual([]);
    expect(
      pageFigureConflicts([
        page(
          "Maji Loop is seeking $5 million in seed funding in 2026.",
          "techcabal.com",
        ),
        page("Maji Loop raised $1 million in seed funding in 2026.", "b.com"),
      ]),
    ).toEqual([]);
  });
});
