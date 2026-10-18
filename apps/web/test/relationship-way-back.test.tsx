// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/relationships/outcome-actions", () => ({
  passAction: vi.fn(),
  pauseAction: vi.fn(),
  resumeAction: vi.fn(),
  passReasonsAction: () => Promise.resolve({ ok: true, value: [] }),
  readPassAction: () => Promise.resolve({ ok: true, value: null }),
  meetingOutcomeAction: vi.fn(),
}));

const { RelationshipOutcome } =
  await import("../src/features/relationships/relationship-outcome");
const { OUTCOME_FIRST, WAY_BACK, nothingLeads } =
  await import("../src/features/relationships/relationship-detail");

afterEach(cleanup);

/**
 * Break-it sweep 2026-10-03 (Zino–Nixo, paused): Resume was only inside the
 * Next card's More, and Book a call led. The way back now leads.
 */
describe("a paused or passed relationship's way back", () => {
  it("is shown above More and leads the Next card", () => {
    expect(OUTCOME_FIRST.has("PAUSED")).toBe(true);
    expect(OUTCOME_FIRST.has("PASSED")).toBe(true);
    expect(WAY_BACK.has("PAUSED")).toBe(true);
    expect(WAY_BACK.has("CONNECTED")).toBe(false);
  });

  it.each([
    ["PAUSED", "Resume"],
    ["PASSED", "Reconsider"],
  ] as const)("%s: %s is the primary action", (state, label) => {
    render(
      <RelationshipOutcome
        relationshipId="00000000-0000-4000-8000-000000000101"
        state={state}
        side="INVESTOR"
        counterpart="Nixo"
      />,
    );
    expect(
      screen.getByRole("button", { name: label }).getAttribute("data-variant"),
    ).toBe("primary");
  });
});

describe("a Next card with nothing to lead with", () => {
  it("says nothing needs you instead of showing a lone More", () => {
    // Interest sent, waiting for the answer (demo-44 phone pass).
    expect(nothingLeads(false, false, "INTEREST_EXPRESSED", false)).toBe(true);
    expect(nothingLeads(true, false, "INTEREST_EXPRESSED", false)).toBe(false);
    expect(nothingLeads(false, true, "CONNECTED", false)).toBe(false);
    expect(nothingLeads(false, false, "PAUSED", false)).toBe(false);
    expect(nothingLeads(false, false, "INTEREST_EXPRESSED", true)).toBe(false);
  });
});
