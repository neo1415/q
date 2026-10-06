// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

import { QCanSee } from "../src/features/q/q-can-see";
import { registerQSection, resetManifest } from "../src/features/q/manifest";
import { QRoomStage } from "../src/features/q/room/q-room-card";
import type { RoomCard } from "../src/features/q/room/room-stage";

/** Q room W2: the room card and the "Q can see" line render and settle. */

afterEach(() => {
  resetManifest();
});

const CARD: RoomCard = {
  key: "DATA_ROOM:00000000-0000-4000-8000-000000000001",
  intent: {
    kind: "SHOW_IN_Q_ROOM",
    object: "DATA_ROOM",
    id: "00000000-0000-4000-8000-000000000001",
    title: "Ledgerline",
  },
  sources: [],
  openedAt: 1,
};

describe("the Q room on screen", () => {
  it("says what Q can see, and follows the page", async () => {
    render(<QCanSee />);
    expect(screen.getByText(/Q room · nothing open/u)).toBeTruthy();
    await act(async () => {
      registerQSection({
        id: "feed",
        kind: "COMPANY_FEED",
        refs: [],
        total: 3,
        label: "3 companies",
      });
      await Promise.resolve();
    });
    expect(screen.getByText(/Q room · 3 companies/u)).toBeTruthy();
  });

  it("shows the card with what the server read, then its close control", async () => {
    const load = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        view: {
          heading: "Ledgerline · Data room",
          lead: null,
          facts: [],
          items: [{ id: "a", title: "Cap table", meta: null }],
          more: 0,
          href: "/company/x?tab=dataroom",
          open: "Open the data room",
        },
      }),
    );
    const onClose = vi.fn();
    render(
      <QRoomStage open={CARD} note={null} onClose={onClose} load={load} />,
    );
    expect(await screen.findByText("Cap table")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    act(() => {
      screen.getByRole("button", { name: /Close Ledgerline/u }).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
