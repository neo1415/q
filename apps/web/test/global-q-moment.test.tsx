// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeMoment,
  formatPlaybackPosition,
  type QMoment,
} from "../src/features/q/q-moment";

/**
 * Q watches the pitch with the person (founder priority, UX-05): opening
 * Q from Discover -- the rail, the dock or Ctrl/Cmd+K -- carries where in
 * the pitch they were. The moment is read at the instant of opening, shown
 * on the Q surface and put at the start of the draft; it belongs to that
 * opening only.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));
vi.mock("@/features/q/q-session", () => ({
  QSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useQSessionOptional: () => null,
}));
vi.mock("@/features/q/q-sheet", () => ({
  QSheetConversation: ({ seed }: { seed?: string | null }) => (
    <p data-testid="sheet-seed">{seed ?? "(empty)"}</p>
  ),
}));

const { GlobalQProvider, useGlobalQ, useQMomentSource } =
  await import("../src/components/app-shell/global-q");

const KOBO: QMoment = {
  kind: "PITCH_MOMENT",
  companyId: "00000001-0000-4000-8000-000000000000",
  companyLabel: "Kobo Logistics",
  mediaAssetId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  positionSeconds: 102,
};

let position = 102;
const sourceReads = vi.fn();

function FeedPage() {
  const { setOpen } = useGlobalQ();
  useQMomentSource(() => {
    sourceReads();
    return { ...KOBO, positionSeconds: position };
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
    </>
  );
}

function PlainPage() {
  const { setOpen } = useGlobalQ();
  return (
    <button type="button" onClick={() => setOpen(true)}>
      open
    </button>
  );
}

function Switcher() {
  const [feed, setFeed] = useState(true);
  return (
    <>
      {feed ? <FeedPage /> : <PlainPage />}
      <button type="button" onClick={() => setFeed(false)}>
        leave
      </button>
    </>
  );
}

function controlsOf(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`no ${label} button`);
  return button;
}

afterEach(() => {
  cleanup();
  position = 102;
  sourceReads.mockReset();
});

describe("a pitch moment", () => {
  it("formats a position as a clock", () => {
    expect(formatPlaybackPosition(0)).toBe("0:00");
    expect(formatPlaybackPosition(102.9)).toBe("1:42");
    expect(formatPlaybackPosition(3725)).toBe("1:02:05");
    expect(formatPlaybackPosition(-4)).toBe("0:00");
    expect(formatPlaybackPosition(Number.NaN)).toBe("0:00");
  });

  it("reads naturally", () => {
    expect(describeMoment(KOBO)).toBe("At 1:42 in Kobo Logistics' pitch");
    expect(describeMoment({ ...KOBO, companyLabel: "Acme" })).toBe(
      "At 1:42 in Acme's pitch",
    );
  });
});

describe("opening Q on a page that plays a pitch", () => {
  it("reads the position at the instant of opening, shows it and starts the draft with it", async () => {
    render(
      <GlobalQProvider subject={{ kind: "NONE", scope: "unset" }} connected>
        <FeedPage />
      </GlobalQProvider>,
    );
    // Not tracked: nothing is read until Q opens.
    expect(sourceReads).not.toHaveBeenCalled();

    act(() => controlsOf("open").click());
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "At 1:42 in Kobo Logistics' pitch: ",
    );
    expect(screen.getByText("At 1:42 in Kobo Logistics' pitch.")).toBeTruthy();
    expect(sourceReads).toHaveBeenCalledTimes(1);

    // A later opening reads the position again.
    act(() => controlsOf("close").click());
    position = 131;
    act(() => controlsOf("open").click());
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "At 2:11 in Kobo Logistics' pitch: ",
    );
  });

  it("opens with the moment from Ctrl/Cmd+K as well", async () => {
    render(
      <GlobalQProvider subject={{ kind: "NONE", scope: "unset" }} connected>
        <FeedPage />
      </GlobalQProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      );
    });
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "At 1:42 in Kobo Logistics' pitch: ",
    );
  });

  it("carries no moment once the page that supplied it has gone", async () => {
    render(
      <GlobalQProvider subject={{ kind: "NONE", scope: "unset" }} connected>
        <Switcher />
      </GlobalQProvider>,
    );
    act(() => controlsOf("leave").click());
    act(() => controlsOf("open").click());
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "(empty)",
    );
    expect(sourceReads).not.toHaveBeenCalled();
  });
});
