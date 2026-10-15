// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCapitalRoundRequestSchema } from "@capital-q/contracts";

const openRoundAction = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/capital/capital-actions", () => ({
  openRoundAction: (...args: unknown[]) => openRoundAction(...args),
}));
vi.mock("../src/features/capital/round-terms-fields", () => ({
  RoundTermsFields: () => null,
}));

import { OpenRound } from "../src/features/capital/open-round";

/**
 * F2: "Add a round" pre-selected SAFE and offered no "not stated", so an
 * undecided founder had to state a false instrument. Now nothing is chosen
 * at first, "Not stated" is a choice, and both send null (unknown).
 */

afterEach(() => {
  cleanup();
  openRoundAction.mockClear();
});

const DRAFT = {
  name: "Seed",
  target: { amount: "500000", currency: "USD" },
  instrument: null,
} as const;

function sent(): unknown {
  const request: unknown = openRoundAction.mock.calls[0]?.[0];
  expect(OpenCapitalRoundRequestSchema.safeParse(request).success).toBe(true);
  return request;
}

async function openNow() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    await Promise.resolve();
  });
}

describe("Add a round: instrument", () => {
  it("pre-selects nothing and offers Not stated", () => {
    render(<OpenRound draft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a round" }));
    const radios = screen.getAllByRole("radio");
    expect(
      radios.map((radio) => radio instanceof HTMLInputElement && radio.checked),
    ).toEqual(radios.map(() => false));
    expect(screen.getByRole("radio", { name: "Not stated" })).toBeTruthy();
    const safe = screen.getByRole("radio", { name: "SAFE" });
    expect(safe instanceof HTMLInputElement && safe.checked).toBe(false);
  });

  it("sends null, not SAFE, when nothing is chosen", async () => {
    render(<OpenRound draft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a round" }));
    await openNow();
    expect(sent()).toMatchObject({ instrument: null, status: "OPEN" });
  });

  it("sends null when Not stated is chosen, and the instrument when one is", async () => {
    render(<OpenRound draft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a round" }));
    fireEvent.click(screen.getByRole("radio", { name: "Not stated" }));
    await openNow();
    expect(sent()).toMatchObject({ instrument: null });
    cleanup();
    openRoundAction.mockClear();
    render(<OpenRound draft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a round" }));
    fireEvent.click(screen.getByRole("radio", { name: "Convertible note" }));
    await openNow();
    expect(sent()).toMatchObject({ instrument: "CONVERTIBLE" });
  });

  it("the contract takes null as not stated and still refuses an unknown code", () => {
    const base = {
      name: "Seed",
      target: { amount: "500000", currency: "USD" },
    };
    expect(
      OpenCapitalRoundRequestSchema.safeParse({ ...base, instrument: null })
        .success,
    ).toBe(true);
    expect(
      OpenCapitalRoundRequestSchema.safeParse({ ...base, instrument: "BOND" })
        .success,
    ).toBe(false);
  });
});
