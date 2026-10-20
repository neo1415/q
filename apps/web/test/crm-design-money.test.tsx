// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapitalLedgerDto } from "@capital-q/contracts";

const actions = vi.hoisted(() => ({
  received: vi.fn(() => Promise.resolve({ ok: true as const })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/capital/capital-actions", () => ({
  confirmAmountAction: vi.fn(),
  confirmReceivedAction: actions.received,
  markSentAction: vi.fn(),
  notRightAction: vi.fn(),
}));
vi.mock("@/features/relationships/commitment-actions", () => ({
  stateCommitmentAction: vi.fn(),
}));

const { minus, moneyList, totalsByCurrency } =
  await import("@/features/capital/money");
const { raiseParts, RaiseBar } = await import("@/features/capital/raise-bar");
const { ladderStep } = await import("@/features/capital/commitment-ladder");
const { CommitmentStepButton } =
  await import("@/features/capital/commitment-sheet");
const { laterAction, laterNote, snoozedRelationships } =
  await import("@/features/relationships/relationships-view");

afterEach(cleanup);

const ROUND = "a0000000-0000-4000-8000-000000000001";
const commitment = (
  over: Partial<CapitalLedgerDto["commitments"][number]>,
): CapitalLedgerDto["commitments"][number] => ({
  id: "b0000000-0000-4000-8000-000000000001",
  relationshipId: "c0000000-0000-4000-8000-000000000001",
  counterpartId: "d0000000-0000-4000-8000-000000000001",
  counterpartName: "Oakum Partners",
  amount: "400000",
  currencyCode: "USD",
  level: "FIRM",
  status: "TRANSFER_SENT",
  source: "PERSON",
  quote: null,
  roundId: ROUND,
  statedByYourSide: false,
  transferReference: "OAK-1810",
  at: "2026-10-18T10:00:00.000Z",
  next: "CONFIRM_RECEIVED",
  ...over,
});

describe("money on the CRM designs", () => {
  it("adds and subtracts exact decimals, kept apart by currency", () => {
    expect(minus("900000.50", "400000.25")).toBe("500000.25");
    expect(minus("1", "5")).toBe("0");
    expect(
      totalsByCurrency([
        { amount: "250000", currency: "GBP" },
        { amount: "0.10", currency: "EUR" },
        { amount: "0.20", currency: "EUR" },
      ]),
    ).toEqual([
      { currency: "GBP", amount: "250000" },
      { currency: "EUR", amount: "0.30" },
    ]);
    expect(
      moneyList([
        { amount: "250000", currency: "GBP" },
        { amount: "400000", currency: "EUR" },
      ]),
    ).toBe("GBP 250,000 and EUR 400,000");
  });

  it("splits the raise into received, sent, confirmed and stated money", () => {
    const round = {
      id: ROUND,
      target: { amount: "3000000", currency: "USD" },
      sums: { raised: "100000", confirmed: "900000", pledged: "250000" },
    } as unknown as CapitalLedgerDto["rounds"][number];
    const parts = raiseParts(round, [
      commitment({}),
      commitment({ id: "x", currencyCode: "EUR" }),
    ]);
    expect(parts).toMatchObject({
      received: "100000",
      sent: "400000",
      confirmed: "500000",
      stated: "250000",
    });
    const { container } = render(
      <RaiseBar parts={parts} words={(english) => english} />,
    );
    expect(
      container.querySelector('[data-meter="sent"]')?.getAttribute("style"),
    ).toContain("13.33%");
    expect(container.textContent).toContain("Sent, not confirmedUSD 400,000");
  });

  it("puts a commitment on the ladder by how far it has come", () => {
    expect(ladderStep(null)).toBeNull();
    expect(ladderStep({ status: "STATED", level: "SOFT" })).toBe(0);
    expect(ladderStep({ status: "STATED", level: "FIRM" })).toBe(1);
    expect(ladderStep({ status: "CONFIRMED", level: "SOFT" })).toBe(2);
    expect(ladderStep({ status: "RECEIVED", level: "SOFT" })).toBe(4);
  });

  it("confirms received money only after the founder checks, naming it", async () => {
    render(
      <CommitmentStepButton
        item={commitment({})}
        side="COMPANY"
        currentRoundId={ROUND}
        variant="primary"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm received" }));
    const sheet = screen.getByRole("dialog", {
      name: "Confirm you received USD 400,000",
    });
    expect(sheet.textContent).toContain("Check your bank account first.");
    expect(sheet.textContent).toContain("OAK-1810");
    expect(actions.received).not.toHaveBeenCalled();
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Confirm received" }),
    );
    // The commitment's own round, so no other round is named.
    expect(actions.received).toHaveBeenCalledWith(
      "b0000000-0000-4000-8000-000000000001",
      null,
    );
    expect(await within(sheet).findByText("Confirmed")).toBeDefined();
  });
});

describe("Later on Needs you", () => {
  it("marks its reminder and carries the action back", () => {
    const note = laterNote({ label: "Reply", href: "/relationships/x" });
    expect(laterAction({ note })).toEqual({
      label: "Reply",
      href: "/relationships/x",
    });
    expect(laterAction({ note: "Call them" })).toBeNull();
    expect(laterAction({ note: null })).toBeNull();
    const now = Date.parse("2026-10-20T10:00:00.000Z");
    const reminder = {
      id: "e0000000-0000-4000-8000-000000000001",
      relationshipId: "f0000000-0000-4000-8000-000000000001",
      meetingId: null,
      title: "x",
      note,
      dueAt: "2026-10-21T09:00:00.000Z",
      channel: "IN_APP" as const,
      status: "PENDING" as const,
    };
    expect([...snoozedRelationships([reminder], now)]).toEqual([
      reminder.relationshipId,
    ]);
    // Due: no longer snoozed; the step comes back.
    expect(
      snoozedRelationships([reminder], Date.parse("2026-10-21T10:00:00Z")).size,
    ).toBe(0);
  });
});
