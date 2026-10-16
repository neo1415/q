// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerCommitmentDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
    expect(
      screen.getByText(
        "USD 250,000 confirmed with 1 company, not yet received",
      ),
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
    expect(screen.getByText("USD 100,000")).toBeDefined();
    expect(screen.getByText("In 1 company")).toBeDefined();
  });
});
