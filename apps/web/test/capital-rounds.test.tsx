// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapitalLedgerDto } from "@capital-q/contracts";

/**
 * Plan P8: the Capital page's round timeline (earlier, now, next), the
 * friendly copy for edge cases, a step sent against the revision it read,
 * and terms typed as exact amounts in the round's own currency.
 */

const step = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const }),
);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../src/features/capital/capital-actions", () => ({
  roundStepAction: (...args: unknown[]) => step(...args),
  reviseRoundAction: () => Promise.resolve({ ok: true }),
  roundHistoryAction: () => Promise.resolve({ events: [] }),
  openRoundAction: () => Promise.resolve({ ok: true }),
}));

const { RoundTimeline } = await import("../src/features/capital/round-card");
const { stepWarning } = await import("../src/features/capital/round-controls");
const { termsFromDraft, changedTerms, EMPTY_DRAFT } =
  await import("../src/features/capital/round-terms");

type Round = CapitalLedgerDto["rounds"][number];

const TERMS: Round["terms"] = {
  targetCloseOn: null,
  valuation: null,
  valuationCap: null,
  discountPercent: null,
  hardCap: null,
  proRataRights: null,
  lead: null,
  extendsRoundId: null,
  reportedRaised: null,
};

const round = (id: string, overrides: Partial<Round>): Round => ({
  id,
  name: "Seed",
  target: { amount: "1000000", currency: "USD" },
  instrument: "SAFE",
  status: "OPEN",
  isCurrent: false,
  openedOn: "2026-09-01",
  firstClosedOn: null,
  closedOn: null,
  cancelledOn: null,
  cancelledReason: null,
  terms: TERMS,
  closes: [],
  corrections: 0,
  revision: 4,
  createdAt: "2026-09-01T09:00:00.000Z",
  sums: { raised: "0", confirmed: "0", pledged: "0" },
  otherCurrencies: [],
  notices: [],
  steps: [],
  ...overrides,
});

const PRE = "99999999-0000-4000-8000-000000000001";
const SEED = "99999999-0000-4000-8000-000000000002";
const BRIDGE = "99999999-0000-4000-8000-000000000003";
const SERIES_A = "99999999-0000-4000-8000-000000000004";

afterEach(() => {
  cleanup();
  step.mockClear();
});

describe("RoundTimeline", () => {
  const rounds = [
    round(PRE, {
      name: "Pre-seed",
      instrument: "ASA",
      status: "CLOSED",
      openedOn: "2024-03-01",
      closedOn: "2024-06-30",
      terms: { ...TERMS, reportedRaised: "320000" },
      steps: ["TRANCHE", "REOPEN"],
    }),
    round(SEED, {
      isCurrent: true,
      status: "FIRST_CLOSED",
      firstClosedOn: "2026-09-20",
    }),
    round(BRIDGE, {
      name: "Seed bridge",
      notices: ["OVERLAPS_OPEN_ROUND", "OTHER_CURRENCY"],
      otherCurrencies: [
        { currencyCode: "GBP", raised: "50000", confirmed: "0", pledged: "0" },
      ],
      terms: { ...TERMS, extendsRoundId: SEED, valuationCap: "8000000" },
      steps: ["CLOSE", "TRANCHE", "FINAL_CLOSE", "CANCEL"],
    }),
    round(SERIES_A, {
      name: "Series A",
      instrument: "EQUITY",
      status: "PLANNED",
      openedOn: null,
      steps: ["OPEN", "CANCEL"],
    }),
  ];

  it("shows earlier, now and next, with status in words and reported money kept apart", () => {
    render(<RoundTimeline rounds={rounds} currentRoundId={SEED} leads={[]} />);
    const groups = screen.getAllByRole("heading", { level: 3 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      "Earlier",
      "Now",
      "Next",
    ]);
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText(/USD 320,000/)).toBeTruthy();
    expect(screen.getByText(/raised elsewhere \(your figure\)/)).toBeTruthy();
    expect(
      screen.getByText(/Your current round: its money and steps are above/),
    ).toBeTruthy();
  });

  it("words the edge cases: overlapping rounds, another currency, an extension", () => {
    render(<RoundTimeline rounds={rounds} currentRoundId={SEED} leads={[]} />);
    expect(
      screen.getByText(/Another round is raising at the same time/),
    ).toBeTruthy();
    expect(screen.getByText(/nothing is converted/)).toBeTruthy();
    expect(screen.getByText(/Also in this round: GBP 50,000/)).toBeTruthy();
    expect(screen.getByText(/extends Seed/)).toBeTruthy();
  });

  it("offers only the steps the server allows, and sends one against the revision it read", async () => {
    render(<RoundTimeline rounds={rounds} currentRoundId={SEED} leads={[]} />);
    expect(
      screen.getAllByRole("button", { name: "Start raising" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Start raising" }));
    const sheetButton = await screen.findAllByRole("button", {
      name: "Start raising",
    });
    // The planned round opening while the bridge raises: said before the press.
    expect(screen.getByText(/Another round is already raising/)).toBeTruthy();
    fireEvent.click(sheetButton[sheetButton.length - 1] as HTMLElement);
    await vi.waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    const [roundId, request, key] = step.mock.calls[0] ?? [];
    expect(roundId).toBe(SERIES_A);
    expect(request).toMatchObject({ expectedRevision: 4, step: "OPEN" });
    expect(String(key)).toMatch(/^round-step:/);
  });
});

describe("step warnings", () => {
  it("asks before a final close with nothing received or reported", () => {
    expect(stepWarning(round(SEED, {}), "FINAL_CLOSE", false)).toMatch(
      /Nothing has been received/,
    );
    expect(
      stepWarning(
        round(SEED, { terms: { ...TERMS, reportedRaised: "0" } }),
        "FINAL_CLOSE",
        false,
      ),
    ).toBeNull();
    expect(
      stepWarning(round(SEED, { status: "CLOSED" }), "REOPEN", false),
    ).toMatch(/extension or a second close/);
  });
});

describe("terms as typed", () => {
  const context = { target: "1,000,000", currency: "USD" };

  it("drops grouping, keeps exact decimals, and leaves the unsaid unknown", () => {
    const result = termsFromDraft(
      { ...EMPTY_DRAFT, valuationCap: "8,000,000", discountPercent: "20%" },
      context,
    );
    expect(result).toEqual({
      ok: true,
      terms: {
        targetCloseOn: null,
        valuation: null,
        valuationCap: "8000000",
        discountPercent: "20",
        hardCap: null,
        proRataRights: null,
        lead: null,
        extendsRoundId: null,
        reportedRaised: null,
      },
    });
  });

  it("refuses symbols, a hard cap below target and a 100% discount, in plain words", () => {
    expect(
      termsFromDraft({ ...EMPTY_DRAFT, valuationCap: "$8m" }, context),
    ).toEqual({
      ok: false,
      message: "Write the valuation cap in USD as a number, like 1500000.",
    });
    expect(
      termsFromDraft({ ...EMPTY_DRAFT, hardCap: "999999" }, context),
    ).toEqual({
      ok: false,
      message: "The hard cap can't be below the target.",
    });
    expect(
      termsFromDraft({ ...EMPTY_DRAFT, discountPercent: "100" }, context).ok,
    ).toBe(false);
  });

  it("an edit sends only what changed, including a cleared term", () => {
    const before = { ...TERMS, valuationCap: "8000000", discountPercent: "20" };
    const after = termsFromDraft(
      { ...EMPTY_DRAFT, valuationCap: "8000000" },
      context,
    );
    if (!after.ok) throw new Error("expected terms");
    expect(changedTerms(before, after.terms)).toEqual({
      discountPercent: null,
    });
  });
});
