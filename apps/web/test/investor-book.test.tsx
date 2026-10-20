// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerCommitmentDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/capital/capital-actions", () => ({
  confirmAmountAction: vi.fn(),
  confirmReceivedAction: vi.fn(),
  markSentAction: vi.fn(),
  notRightAction: vi.fn(),
}));
vi.mock("@/features/relationships/commitment-actions", () => ({
  stateCommitmentAction: vi.fn(),
}));

const { InvestorBook } = await import("../src/features/capital/capital-book");

afterEach(cleanup);

const commitment = (
  over: Partial<LedgerCommitmentDto>,
): LedgerCommitmentDto => ({
  id: "a0000000-0000-4000-8000-000000000001",
  relationshipId: "b0000000-0000-4000-8000-000000000001",
  counterpartId: "c0000000-0000-4000-8000-000000000001",
  counterpartName: "Ledgerfold",
  amount: "250000",
  currencyCode: "USD",
  level: "FIRM",
  status: "CONFIRMED",
  source: "PERSON",
  quote: null,
  roundId: null,
  statedByYourSide: true,
  transferReference: null,
  at: "2026-10-04T10:00:00.000Z",
  next: null,
  ...over,
});

describe("the investor's Capital (live check 2026-10-16)", () => {
  it("says nothing received in words, never a large USD 0 beside confirmed money", () => {
    render(
      <InvestorBook
        mine={{
          totals: [
            {
              currencyCode: "USD",
              raised: "0",
              confirmed: "250000",
              pledged: "0",
            },
          ],
          commitments: [commitment({})],
        }}
      />,
    );
    expect(screen.getByText("Nothing received yet")).toBeDefined();
    expect(screen.queryByText("USD 0")).toBeNull();
    // Committed money sits apart from received, never added in.
    const totals = document.querySelector("[data-capital-totals]");
    expect(totals?.textContent).toContain(
      "Committed, not yet receivedUSD 250,000confirmed",
    );
    expect(totals?.textContent).toContain("Every amount is recorded");
  });

  it("puts this side's next step on the row, as a sheet naming the amount", () => {
    render(
      <InvestorBook
        mine={{
          totals: [
            {
              currencyCode: "USD",
              raised: "0",
              confirmed: "250000",
              pledged: "0",
            },
          ],
          commitments: [commitment({ next: "MARK_SENT" })],
        }}
      />,
    );
    const row = document.querySelector('[data-book-row="CONFIRMED"]');
    expect(row?.querySelector('[data-ladder="2"]')).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark the transfer as sent" }),
    );
    const sheet = screen.getByRole("dialog", {
      name: "Mark the transfer as sent",
    });
    expect(
      within(sheet).getByRole("button", { name: "Mark USD 250,000 as sent" }),
    ).toBeDefined();
    expect(sheet.textContent).toContain("Q never marks it received for them.");
  });

  it("says an invested company's missing amount is unknown, and offers to record it", () => {
    render(
      <InvestorBook
        mine={{ totals: [], commitments: [] }}
        unrecorded={[
          {
            relationshipId: "b0000000-0000-4000-8000-000000000009",
            companyId: "c0000000-0000-4000-8000-000000000009",
            name: "Northbeam",
            since: "2026-10-13T10:00:00.000Z",
          },
        ]}
      />,
    );
    const totals = document.querySelector("[data-capital-totals]");
    expect(totals?.textContent).toContain(
      "Unknown1 amountNorthbeam, not recorded",
    );
    const row = document.querySelector('[data-book-row="unrecorded"]');
    expect(row?.textContent).toContain("Not recorded");
    expect(row?.textContent).not.toMatch(/USD 0/u);
    expect(
      screen.getByRole("button", { name: "Confirm the amount" }),
    ).toBeDefined();
  });

  it("counts invested companies by money received", () => {
    render(
      <InvestorBook
        mine={{
          totals: [
            {
              currencyCode: "USD",
              raised: "100000",
              confirmed: "0",
              pledged: "0",
            },
          ],
          commitments: [commitment({ status: "RECEIVED" })],
        }}
      />,
    );
    const totals = document.querySelector("[data-capital-totals]");
    expect(totals?.textContent).toContain(
      "Received by companiesUSD 100,000Confirmed by both sides",
    );
    const row = document.querySelector('[data-book-row="RECEIVED"]');
    expect(row?.querySelector('[data-ladder="4"]')).not.toBeNull();
    expect(row?.textContent).toContain("Received");
  });
});
