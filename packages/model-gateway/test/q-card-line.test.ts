import { describe, expect, it } from "vitest";

import { qCardLine, withQCardLink } from "../src/q/q-card-offer.js";

/**
 * QA F10 (25 Oct 2026): "approve the claim on the card" with no card on
 * screen. The line points at the card only when the claim was prepared.
 */
const NOT_MADE = {
  status: "NOT_MADE" as const,
  handle: null,
  publicUrl: null,
  suggestedHandle: "maji-loop",
  suggestedUrl: "https://capitalq.example/@maji-loop",
};

describe("QA F10: their Q Card line", () => {
  it("points at the approval card when the claim was prepared", () => {
    expect(qCardLine(NOT_MADE, true)).toContain(
      "approve the claim on the card",
    );
  });

  it("offers the claim, and points at no card, when none was prepared", () => {
    const line = qCardLine(NOT_MADE, false);
    expect(line).not.toContain("on the card");
    expect(line).toContain("@maji-loop");
    expect(line).toContain("https://capitalq.example/@maji-loop");
    expect(
      withQCardLink(
        "There's no Q Card yet; approve the claim on the card at https://capitalq.example/@maji-loop.",
        NOT_MADE,
        false,
      ),
    ).not.toContain("on the card");
  });
});
