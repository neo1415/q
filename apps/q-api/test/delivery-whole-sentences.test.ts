import { describe, expect, it } from "vitest";

import {
  chatRecommendation,
  deliveryText,
  type DeliveredDocument,
} from "../src/composition/workforce/delivery.js";

/**
 * Replay of scenario G (live 2026-11-16, run b87ad973 and its job
 * f19b102e): the chat line that delivered "Halyard Security: seed-round
 * investor gaps and evidence map" ended two of its three items
 * mid-sentence ("…(estimate: 17,157 + 13,450 + 7,176 + 5,303…", "…with
 * approved…"): each recommendation is cut at 300 characters for its stored
 * bound (models.ts `prose`; the analyst's recorded requests are keyed on
 * it, so the bound stays), and the chat said the cut as it was.
 */
const LIVE_FIRST =
  "Within five business days, produce a customer-level reconciliation of the 11-customer, 71,000-seat and £852,000 ARR claims to contracts, invoices, enrolment records and collections, explicitly resolving the four-entry visible subtotal of 43,086 seats (estimate: 17,157 + 13,450 + 7,176 + 5,303…";
const LIVE_SECOND =
  "Complete the pre-close financial, security and financing pack: reconcile revenue and gross margin, substantiate the zero-phishing-takeover outcome, and provide cap-table, valuation, dilution, rights and use-of-proceeds evidence.";
const LIVE_THIRD =
  "Address Halyard-specific public-sector execution risk by documenting framework routes, procurement timelines, call-off constraints, implementation capacity, support cost per go-live and customer-level renewal or expansion evidence; handle Thames Arc Capital and Zino Aviation with approved…";

function document(topRecommendations: readonly string[]): DeliveredDocument {
  return {
    artifactId: "e7944796-6559-4107-9d5c-d0f86b64a519",
    delivery: {
      title: "Halyard Security: seed-round investor gaps and evidence map",
      artifactType: "ANALYSIS",
      summary: "Halyard has a specific public-sector proposition.",
      topRecommendations: [...topRecommendations],
      passed: true,
      openIssues: 0,
    },
  };
}

/** The numbered items of the chat line. */
function items(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^\d+\. /u.test(line))
    .map((line) => line.replace(/^\d+\. /u, ""));
}

describe("a delivered document's chat line never cuts an item mid-sentence", () => {
  it("the live delivery: no item ends mid-sentence, and the rest are counted", () => {
    const text = deliveryText(document([LIVE_FIRST, LIVE_SECOND, LIVE_THIRD]));
    expect(items(text)).toEqual([LIVE_SECOND]);
    expect(text).not.toContain("…");
    expect(text).toContain("2 more recommendations are in the document.");
  });

  it("a cut item goes back to its last whole sentence when it has one", () => {
    const cut =
      "Reconcile the 71,000 seats to enrolment records. Then reconcile the £852,000 ARR to invoices, contracts and collections for each of the eleven customers named in the deck, explicitly resolving…";
    const text = deliveryText(document([cut, LIVE_SECOND]));
    expect(items(text)).toEqual([
      "Reconcile the 71,000 seats to enrolment records.",
      LIVE_SECOND,
    ]);
    expect(text).toContain("Each recommendation is in full in the document.");
  });

  it("keeps whole recommendations exactly as written, with nothing added", () => {
    const text = deliveryText(document(["Verify the entity.", LIVE_SECOND]));
    expect(items(text)).toEqual(["Verify the entity.", LIVE_SECOND]);
    expect(text).not.toContain("in the document.");
    expect(chatRecommendation("Verify the entity.")).toEqual({
      text: "Verify the entity.",
      shortened: false,
    });
  });
});
