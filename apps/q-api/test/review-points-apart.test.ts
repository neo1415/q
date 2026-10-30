import { describe, expect, it } from "vitest";

import {
  REVIEW_OPEN_POINT_PREFIX,
  documentFromArtifact,
} from "@capital-q/deck-render";
import { clipAtWord, cutAtWord } from "@capital-q/q-core";

import { REVIEWER_OPEN_POINT } from "../src/composition/workforce/analysis.js";
import {
  NOT_KNOWN_HEADING,
  diligenceContent,
} from "../src/composition/workforce/diligence-memo.js";

/**
 * Investor lane 2026-10-30 (IC memo): the review's open points were read
 * as part of the memo ("Reviewer's open point (…)" in its Not known
 * section and among its evidence gaps), and shown text was cut mid-word
 * ("risks soundin", "Luxem").
 */

const REVIEW_POINT = `${REVIEWER_OPEN_POINT} (Market): The memo gives no bounded sizing framework.`;

describe("a review's open points are kept apart from the memo", () => {
  it("the PDF's marker is the one the workforce files", () => {
    expect(REVIEW_OPEN_POINT_PREFIX).toBe(REVIEWER_OPEN_POINT);
  });

  it("the memo's Not known section names what is not known, never what the review left open", () => {
    const content = diligenceContent({
      content: {
        sections: [{ heading: "Market", body: "Unknown.", findings: [] }],
        gaps: ["Cash and runway are not stated.", REVIEW_POINT],
      },
      claims: { heading: "Claims vs evidence", body: "None.", findings: [] },
    });
    const notKnown = content.sections.find(
      (section) => section.heading === NOT_KNOWN_HEADING,
    );
    expect(notKnown?.body).toBe("- Cash and runway are not stated.");
    // Still filed with the document, shown apart under its own label.
    expect(content.gaps).toContain(REVIEW_POINT);
  });

  it("the PDF prints them under their own label, in plain words", () => {
    const document = documentFromArtifact({
      type: "ANALYSIS",
      version: {
        version: 1,
        title: "Memo",
        summary: undefined,
        createdAt: "2026-10-30T20:00:00.000Z",
        content: {
          sections: [],
          gaps: ["Cash and runway are not stated.", REVIEW_POINT],
        },
      } as never,
    });
    expect(document.gaps).toEqual(["Cash and runway are not stated."]);
    expect(document.reviewOpen).toEqual([
      "Market: The memo gives no bounded sizing framework.",
    ]);
  });
});

describe("shown text is never cut mid-word", () => {
  const long =
    "The memo states that the UK geography is not among the strongly preferred markets, while the declared preferences list Belgium, Luxembourg, the Netherlands and the Nordics.";

  it("cutAtWord ends at a whole word with an ellipsis", () => {
    const cut = cutAtWord(long, 120);
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    const next = long[cut.length - 1];
    expect(next === " " || next === ",").toBe(true);
  });

  it("clipAtWord prefers a whole sentence, else a whole word", () => {
    expect(
      clipAtWord("Runway is 14 months. Burn is flat since March.", 30),
    ).toBe("Runway is 14 months.");
    const cut = clipAtWord(long, 100);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/Luxem…$/u);
  });
});
