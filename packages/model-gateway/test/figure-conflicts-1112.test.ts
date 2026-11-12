import { describe, expect, it } from "vitest";

import { parseQResultBlocks } from "@capital-q/contracts";

import {
  figureConflictBlocks,
  figureConflicts,
} from "../src/q/figure-conflicts.js";

/**
 * Investigation milestone, gap 2 (12 Nov): the company's own figure and a
 * public page's figure for the same measure, when they disagree, are shown
 * side by side and left unreconciled. Narrow on purpose: a conflict shown
 * must be a real one.
 */
const claim = (statement: string, extra: Record<string, string> = {}) => ({
  ref: "F1",
  statement,
  truthClass: "USER_CLAIM",
  source: "The company's Capital Q profile (self-reported)",
  ...extra,
});
const page = (
  excerpt: string,
  subjectMatch = "MATCH",
  domain = "techcabal.com",
) => ({
  domain,
  excerpt,
  subjectMatch,
});

describe("figure conflicts", () => {
  it("shows a company figure a matched page contradicts, both sides, unreconciled", () => {
    const conflicts = figureConflicts({
      facts: [
        claim("Paystack serves 400,000 merchant businesses across Africa."),
      ],
      pages: [
        page(
          "The company said it now serves 200,000 merchant businesses across Africa. Other news follows.",
        ),
      ],
    });
    expect(conflicts).toHaveLength(1);
    const blocks = figureConflictBlocks(conflicts);
    expect(parseQResultBlocks(blocks).blocks).toHaveLength(1);
    const [block] = blocks;
    if (block?.kind !== "UNCERTAINTY") throw new Error("expected UNCERTAINTY");
    expect(block.confidence).toBe("CONFLICTING_EVIDENCE");
    expect(block.statement).toContain("400,000 merchant businesses");
    expect(block.statement).toContain("200,000 merchant businesses");
    expect(block.statement).toContain("techcabal.com (not verified)");
    expect(block.statement).toContain("not reconciled");
  });

  it("agreement within rounding, another measure, another unit or year is no conflict", () => {
    const facts = [
      claim("Paystack serves 400,000 merchant businesses across Africa."),
    ];
    const none = (excerpt: string) =>
      figureConflicts({ facts, pages: [page(excerpt)] });
    // Rounded the same.
    expect(
      none("Paystack serves about 400k merchant businesses across Africa."),
    ).toEqual([]);
    // Another measure.
    expect(none("Paystack has 900 employees in four offices.")).toEqual([]);
    // Another unit: an amount is not a count.
    expect(
      none("Merchant businesses across Africa paid $200,000 in fees."),
    ).toEqual([]);
    // Another year than the claim's.
    expect(
      figureConflicts({
        facts: [claim("Paystack served 400,000 merchant businesses in 2026.")],
        pages: [page("Paystack served 60,000 merchant businesses in 2019.")],
      }),
    ).toEqual([]);
  });

  it("never compares Q's inference, nor a page that may not be about them", () => {
    expect(
      figureConflicts({
        facts: [
          claim("Paystack serves 400,000 merchant businesses across Africa.", {
            truthClass: "Q_INFERENCE",
          }),
        ],
        pages: [page("It serves 200,000 merchant businesses across Africa.")],
      }),
    ).toEqual([]);
    expect(
      figureConflicts({
        facts: [
          claim("Paystack serves 400,000 merchant businesses across Africa."),
        ],
        pages: [
          page(
            "It serves 200,000 merchant businesses across Africa.",
            "POSSIBLE",
          ),
          page("It serves 200,000 merchant businesses across Africa.", "NONE"),
        ],
      }),
    ).toEqual([]);
  });

  it("no figure in the claim, nothing to compare; at most three conflicts", () => {
    expect(
      figureConflicts({
        facts: [claim("Paystack is a payments company in Lagos.")],
        pages: [page("Paystack is a payments company with 900 staff.")],
      }),
    ).toEqual([]);
    const many = figureConflicts({
      facts: [
        claim("Paystack serves 400,000 merchant businesses across Africa."),
      ],
      pages: ["a.com", "b.com", "c.com", "d.com"].map((domain) =>
        page(
          "It serves 100,000 merchant businesses across Africa.",
          "MATCH",
          domain,
        ),
      ),
    });
    expect(many).toHaveLength(3);
  });
});
