// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/discover/feed/feed-actions", () => ({
  recordDecisionAction: vi.fn(),
  undoPassAction: vi.fn(),
}));
vi.mock("../src/features/fit/fit-actions", () => ({
  fitCompareAction: vi.fn(),
  fitQViewAction: vi.fn(() => Promise.resolve(null)),
}));

import { sinceYouLastSawLine } from "../src/features/discover/feed-card";
import {
  newClientEventId,
  Shortlist,
  type ShortlistPorts,
} from "../src/features/discover/shortlist";
import type { ShortlistRow } from "../src/features/discover/shortlist-data";

/**
 * Saved, Passed and Compare (app prototype "shortlist", option 1): Saved
 * is best fit first with a compare tray for up to three; Pass is
 * optimistic and moves the company to Passed; Undo pass is one idempotent
 * press, retried with the same key; a reintroduced card says why it is
 * back.
 */
afterEach(cleanup);

const LEDGERFOLD = "84b9641f-b618-4fa3-8b35-1d19b1c71d82";
const NSUO = "b439cd80-55d4-491a-922f-95650c38a056";
const KIVU = "c439cd80-55d4-491a-922f-95650c38a057";
const OKAPI = "d439cd80-55d4-491a-922f-95650c38a058";

const company = (companyId: string, name: string): ShortlistRow => ({
  companyId,
  name,
  description: `${name} does one thing well`,
  facts: "Seed · Kenya",
  band: "STRONG_FIT",
});

function ports(overrides: Partial<ShortlistPorts> = {}): ShortlistPorts {
  return {
    decide: vi.fn(() =>
      Promise.resolve({ ok: true, value: {} } as Awaited<
        ReturnType<ShortlistPorts["decide"]>
      >),
    ),
    undoPass: vi.fn(() =>
      Promise.resolve({ ok: true, value: {} } as Awaited<
        ReturnType<ShortlistPorts["undoPass"]>
      >),
    ),
    compare: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
}

const top = { kind: "ERROR" } as const;

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

describe("Saved", () => {
  it("lists saved companies best fit first, with the band in words", () => {
    render(
      <Shortlist
        initialTab="SAVED"
        saved={[company(LEDGERFOLD, "Ledgerfold"), company(NSUO, "Nsuo Labs")]}
        passed={[]}
        top={top}
        ports={ports()}
      />,
    );
    const rows = document.querySelectorAll("[data-saved-company]");
    expect(
      [...rows].map((row) => row.getAttribute("data-saved-company")),
    ).toEqual([LEDGERFOLD, NSUO]);
    expect(screen.getAllByText("Strong fit").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Best fit first. Saving isn’t interest, and viewing counts for nothing here.",
      ),
    ).toBeTruthy();
  });

  it("raises the tray on a pick and allows three at most", () => {
    render(
      <Shortlist
        initialTab="SAVED"
        saved={[
          company(LEDGERFOLD, "Ledgerfold"),
          company(NSUO, "Nsuo Labs"),
          company(KIVU, "Kivu"),
          company(OKAPI, "Okapi"),
        ]}
        passed={[]}
        top={top}
        ports={ports()}
      />,
    );
    const tray = document.querySelector("[data-compare-tray]");
    expect(tray?.getAttribute("aria-hidden")).toBe("true");
    for (const id of [LEDGERFOLD, NSUO, KIVU, OKAPI]) {
      fireEvent.click(element(`[data-pick="${id}"]`));
    }
    expect(tray?.getAttribute("aria-hidden")).toBe("false");
    expect(tray?.textContent).toContain("3 selected");
    expect(
      document
        .querySelector(`[data-pick="${OKAPI}"]`)
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("passes optimistically: the row leaves Saved and appears in Passed, recorded as pass then unsave", async () => {
    vi.useFakeTimers();
    const live = ports();
    render(
      <Shortlist
        initialTab="SAVED"
        saved={[company(LEDGERFOLD, "Ledgerfold")]}
        passed={[]}
        top={top}
        ports={live}
      />,
    );
    await act(async () => {
      fireEvent.click(element(`[data-pass="${LEDGERFOLD}"]`));
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();
    expect(document.querySelector("[data-saved-company]")).toBeNull();
    const intents = (live.decide as ReturnType<typeof vi.fn>).mock.calls.map(
      ([input]) => (input as { intent: string; surface: string }).intent,
    );
    expect(intents).toEqual(["PASS", "UNSAVE"]);
    fireEvent.click(screen.getByRole("button", { name: "Passed" }));
    expect(
      document.querySelector(`[data-passed-company="${LEDGERFOLD}"]`),
    ).not.toBeNull();
  });
});

describe("Passed", () => {
  it("undo pass keeps one key across a failed try and its retry, then says it is back", async () => {
    const undoPass = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "try again" })
      .mockResolvedValueOnce({ ok: true, value: {} });
    render(
      <Shortlist
        initialTab="PASSED"
        saved={[]}
        passed={[company(LEDGERFOLD, "Ledgerfold")]}
        top={top}
        ports={ports({ undoPass })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo pass" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Undo pass" }));
    await waitFor(() => {
      expect(
        screen.getByText("Back in Discover from your next page"),
      ).toBeTruthy();
    });
    const keys = undoPass.mock.calls.map(
      ([input]) => (input as { clientEventId: string }).clientEventId,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_:-]{8,64}$/);
  });

  it("each press gets a fresh, valid idempotency key", () => {
    const a = newClientEventId("unpass");
    expect(a).toMatch(/^[A-Za-z0-9_:-]{8,64}$/);
    expect(newClientEventId("unpass")).not.toBe(a);
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
