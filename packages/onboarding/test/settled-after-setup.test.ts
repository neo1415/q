import { describe, expect, it } from "vitest";

import { isLocalFigureProposal, settledAfterSetup } from "../src/index.js";

/**
 * Owner 2026-10-28: every real founder has finished setup, so a figure read
 * from their financial document is offered, kept, changed or refused on
 * their completed journey, on a revisable step (ADR 0024). Nothing else
 * reopens a completed session, and nobody re-enters setup.
 */

const FIGURE = [
  { sourceType: "EVIDENCE_DOCUMENT" },
  { sourceType: "EVIDENCE_DOCUMENT_VERSION" },
  { sourceType: "LOCAL_FIGURE" },
];
const REVISABLE = new Set(["F5.monthly_revenue", "F5.cash"]);

describe("settledAfterSetup", () => {
  it("admits a local figure on a revisable step of a completed journey", () => {
    expect(isLocalFigureProposal(FIGURE)).toBe(true);
    expect(
      settledAfterSetup({
        status: "COMPLETED",
        stepKey: "F5.monthly_revenue",
        sourceRefs: FIGURE,
        revisable: REVISABLE,
      }),
    ).toBe(true);
  });

  it("refuses any other offer, any other step and any other status", () => {
    const base = {
      status: "COMPLETED",
      stepKey: "F5.monthly_revenue",
      sourceRefs: FIGURE,
      revisable: REVISABLE,
    } as const;
    // A deck reading or research proposal does not reopen setup.
    expect(
      settledAfterSetup({
        ...base,
        sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT" }],
      }),
    ).toBe(false);
    expect(settledAfterSetup({ ...base, stepKey: "F1.company_name" })).toBe(
      false,
    );
    expect(settledAfterSetup({ ...base, revisable: undefined })).toBe(false);
    // An open session takes the ordinary path; an abandoned one takes none.
    expect(settledAfterSetup({ ...base, status: "ACTIVE" })).toBe(false);
    expect(settledAfterSetup({ ...base, status: "ABANDONED" })).toBe(false);
  });
});
