// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { decided, decisionOf } from "@/features/relationships/decision";
import { DecisionRecord } from "@/features/relationships/decision-record";

afterEach(cleanup);

const status = (
  state: string,
  milestones: { state: string; at: string }[],
) => ({
  state: state as "PASSED",
  stateSince: milestones.at(-1)?.at ?? "2026-10-10T10:00:00.000Z",
  milestones: milestones as { state: "PASSED"; at: string }[],
});
const pass = (extra: Record<string, unknown> = {}) => ({
  pass: {
    passedAt: "2026-10-10T10:00:00.000Z",
    reasonCode: "MARKET_SIZE" as never,
    reasonLabel: "Market too small",
    note: "Revisit at Series A",
    sharedWithFounder: false,
    ...extra,
  },
});

describe("the decision on a record (CRM S5)", () => {
  it("is only for decision states", () => {
    expect(decided(null)).toBe(false);
    expect(decided({ state: "CONNECTED" })).toBe(false);
    for (const state of ["PASSED", "INVESTED"] as const)
      expect(decided({ state })).toBe(true);
    // Already the hero's state line: no card of its own.
    for (const state of ["IN_DILIGENCE", "PAUSED"] as const)
      expect(decided({ state })).toBe(false);
    expect(
      decisionOf({
        relationship: status("CONNECTED", []),
        side: "INVESTOR",
      }),
    ).toBeNull();
  });

  it("gives an investor's pass with its reason, note and who can see it, after earlier decisions", () => {
    const decision = decisionOf({
      relationship: status("PASSED", [
        { state: "CONNECTED", at: "2026-10-01T10:00:00.000Z" },
        { state: "IN_DILIGENCE", at: "2026-10-03T10:00:00.000Z" },
        { state: "PASSED", at: "2026-10-10T10:00:00.000Z" },
      ]),
      side: "INVESTOR",
      pass: pass(),
    });
    expect(decision).toMatchObject({
      title: "Passed",
      details: [
        "Reason: Market too small",
        "Note: Revisit at Series A",
        "Reason private to your firm",
      ],
      earlier: [{ title: "Diligence started", at: "2026-10-03T10:00:00.000Z" }],
    });
  });

  it("says a founder sees no reason unless shared, and never guesses one", () => {
    const relationship = status("PASSED", [
      { state: "PASSED", at: "2026-10-10T10:00:00.000Z" },
    ]);
    expect(
      decisionOf({ relationship, side: "COMPANY", pass: { pass: null } })
        ?.details,
    ).toEqual(["No reason shared"]);
    expect(
      decisionOf({ relationship, side: "COMPANY", pass: undefined })?.details,
    ).toEqual(["The reason couldn't be read"]);
    expect(
      decisionOf({
        relationship,
        side: "INVESTOR",
        pass: pass({ reasonLabel: null, note: null, sharedWithFounder: true }),
      })?.details,
    ).toEqual(["No reason recorded", "Reason shared with the founder"]);
  });

  it("gives an investment with its money, or says it could not be read", () => {
    const relationship = status("INVESTED", [
      { state: "INVESTED", at: "2026-10-12T10:00:00.000Z" },
    ]);
    expect(
      decisionOf({ relationship, side: "INVESTOR", commitments: undefined })
        ?.details,
    ).toEqual(["Commitment couldn't be read"]);
  });

  it("renders the decision first, dated, with earlier ones as one quiet line", () => {
    const decision = decisionOf({
      relationship: status("PASSED", [
        { state: "IN_DILIGENCE", at: "2026-10-03T10:00:00.000Z" },
        { state: "PASSED", at: "2026-10-10T10:00:00.000Z" },
      ]),
      side: "INVESTOR",
      pass: pass(),
    });
    if (decision === null) throw new Error("expected a decision");
    render(<DecisionRecord decision={decision} />);
    expect(screen.getByText("Passed")).toBeDefined();
    expect(screen.getByText("Reason: Market too small")).toBeDefined();
    expect(screen.getByText(/Earlier: Diligence started 3 Oct/u)).toBeDefined();
  });
});
