// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const undo = vi.fn();
vi.mock("../src/features/discover/feed/feed-actions", () => ({
  undoPassAction: (input: unknown) => undo(input) as unknown,
}));
vi.mock("../src/features/discover/company-pitch", () => ({
  CompanyPitch: ({ company }: { company: { companyId: string } }) => (
    <div data-testid={`pitch-${company.companyId}`} />
  ),
}));

import { sinceYouLastSawLine } from "../src/features/discover/feed-card";
import {
  newClientEventId,
  PassedCompanies,
} from "../src/features/discover/passed-companies";

/**
 * Passed (doc 19 §66–68; founder report 2026-10-02): every passed company
 * is listed with its pitch and Undo pass; undoing is one idempotent press,
 * retried with the same key; a reintroduced card says why it is back.
 */
const LEDGERFOLD = "84b9641f-b618-4fa3-8b35-1d19b1c71d82";
const NSUO = "b439cd80-55d4-491a-922f-95650c38a056";
const pitch = {
  mediaAssetId: "38579af4-cfa2-4fd8-9381-d9f562768c03",
  aspectRatio: "9:16",
  durationSeconds: 60,
  captionState: "NOT_REQUESTED" as const,
};

describe("Passed", () => {
  it("lists each passed company with its pitch, whatever the slate says", () => {
    render(
      <PassedCompanies
        companies={[
          { companyId: LEDGERFOLD, name: "Ledgerfold", facts: null, pitch },
          { companyId: NSUO, name: "Nsuo Labs", facts: null, pitch: null },
        ]}
      />,
    );
    expect(screen.getByTestId(`pitch-${LEDGERFOLD}`)).toBeTruthy();
    expect(screen.queryByTestId(`pitch-${NSUO}`)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Undo pass" })).toHaveLength(
      2,
    );
  });

  it("undo pass: one key per press, retried with the same key, then says it is back", async () => {
    undo.mockReset();
    undo
      .mockResolvedValueOnce({ ok: false, message: "try again" })
      .mockResolvedValueOnce({ ok: true, value: {} });
    render(
      <PassedCompanies
        companies={[
          {
            companyId: LEDGERFOLD,
            name: "Ledgerfold",
            facts: null,
            pitch: null,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo pass" }));
    await waitFor(() => {
      expect(
        screen.getByText("Back in Discover from your next page"),
      ).toBeTruthy();
    });
    const keys = undo.mock.calls.map(
      ([input]) => (input as { clientEventId: string }).clientEventId,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_:-]{8,64}$/);
  });

  it("each press gets a fresh, valid idempotency key", () => {
    const a = newClientEventId();
    expect(a).toMatch(/^[A-Za-z0-9_:-]{8,64}$/);
    expect(newClientEventId()).not.toBe(a);
  });
});

describe("a passed company offered again", () => {
  it("says why it is back, in words", () => {
    expect(sinceYouLastSawLine("NEW_PITCH")).toBe(
      "New pitch since you last saw it. You passed on it before.",
    );
    expect(sinceYouLastSawLine(null)).toContain("since you last saw it");
  });
});
