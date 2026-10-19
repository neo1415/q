// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EndOfSlate,
  FeedMomentToast,
  PASS_REASON_CHOICES,
} from "../src/features/discover/feed-moments";

/**
 * Discover A's moments (owner 2026-10-19): after a pass, one quiet toast
 * with Undo and an optional reason (never required, doc 17 §67); after a
 * confirmed interest, the way to the relationship; and the end of the
 * slate with this visit's own counts, never a popularity figure.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const COMPANY = "00000001-0000-4000-8000-000000000000";

describe("the pass toast", () => {
  it("offers the reasons and Undo; a reason is sent once and acknowledged", () => {
    const onReason = vi.fn();
    const onUndo = vi.fn();
    const onDone = vi.fn();
    render(
      <FeedMomentToast
        moment={{
          kind: "PASSED",
          id: 1,
          companyId: COMPANY,
          companyName: "Watchly",
        }}
        onUndoPass={onUndo}
        onUndoSave={() => undefined}
        onPassReason={onReason}
        onDone={onDone}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Passed Watchly");
    for (const choice of PASS_REASON_CHOICES) {
      expect(screen.getByRole("button", { name: choice.label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Not my sector" }));
    expect(onReason).toHaveBeenCalledExactlyOnceWith(COMPANY, "SECTOR");
    // The chips give way to an acknowledgement: no second reason.
    expect(screen.queryByRole("button", { name: "Too early" })).toBeNull();
    expect(screen.getByText("Noted for your feed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledExactlyOnceWith(COMPANY);
    expect(onDone).toHaveBeenCalled();
  });

  it("goes by itself after a while, but not while the pointer is on it", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(
      <FeedMomentToast
        moment={{
          kind: "PASSED",
          id: 2,
          companyId: COMPANY,
          companyName: "Watchly",
        }}
        onUndoPass={() => undefined}
        onUndoSave={() => undefined}
        onPassReason={() => undefined}
        onDone={onDone}
      />,
    );
    fireEvent.pointerEnter(screen.getByRole("status"));
    vi.advanceTimersByTime(10_000);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.pointerLeave(screen.getByRole("status"));
    vi.advanceTimersByTime(6_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("the interest toast", () => {
  it("says the company is notified and links to the relationship", () => {
    render(
      <FeedMomentToast
        moment={{
          kind: "INTEREST",
          id: 3,
          companyId: COMPANY,
          companyName: "Watchly",
        }}
        onUndoPass={() => undefined}
        onUndoSave={() => undefined}
        onPassReason={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Interest recorded · Watchly is notified",
    );
    expect(
      screen.getByRole("link", { name: "View in CRM" }).getAttribute("href"),
    ).toBe(`/relationships/company/${COMPANY}`);
    // No Undo for a server-confirmed interest: it already told someone.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("the save toast", () => {
  it("says what was saved and undoes it", () => {
    const onUndoSave = vi.fn();
    render(
      <FeedMomentToast
        moment={{
          kind: "SAVED",
          id: 4,
          companyId: COMPANY,
          companyName: "Watchly",
        }}
        onUndoPass={() => undefined}
        onUndoSave={onUndoSave}
        onPassReason={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Saved Watchly");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndoSave).toHaveBeenCalledExactlyOnceWith(COMPANY);
  });
});

describe("the end of the slate", () => {
  it("counts this visit's decisions and offers the saved list and a way back", () => {
    const onBack = vi.fn();
    render(
      <EndOfSlate
        tally={{ saved: 1, interest: 1, passed: 2 }}
        onBack={onBack}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "You're through today's slate." }),
    ).toBeTruthy();
    const counts = [...document.querySelectorAll(".cq-feed-end-tally dd")].map(
      (node) => node.textContent,
    );
    expect(counts).toEqual(["1", "1", "2"]);
    expect(
      screen
        .getByRole("link", { name: "Review saved companies" })
        .getAttribute("href"),
    ).toBe("/discover/saved");
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the last company" }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
