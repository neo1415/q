// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

import { QCanSee, seeingMutation } from "../src/features/q/q-can-see";
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

  it("follows a part hidden from Q and a window opened, on the next frame (W7)", async () => {
    const change = (mutate: () => void) =>
      act(async () => {
        mutate();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    const part = document.createElement("div");
    part.innerHTML = '<div data-q-section="feed"></div>';
    document.body.append(part);
    render(<QCanSee />);
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
    // The person hides the part: no timer, one frame later.
    await change(() => part.setAttribute("data-q-hidden", ""));
    expect(screen.getByText(/Q room · nothing open/u)).toBeTruthy();
    await change(() => part.removeAttribute("data-q-hidden"));
    expect(screen.getByText(/Q room · 3 companies/u)).toBeTruthy();
    // A window no code registered.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Clearwater preview");
    await change(() => document.body.append(dialog));
    expect(screen.getByText(/window: Clearwater preview/u)).toBeTruthy();
    await change(() => dialog.remove());
    expect(screen.queryByText(/window: Clearwater preview/u)).toBeNull();
    part.remove();
  });

  it("ignores DOM changes that cannot change the line (W7)", () => {
    const text = document.createTextNode("streamed words");
    const plain = document.createElement("p");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const record = (added: Node[]) =>
      ({
        type: "childList",
        addedNodes: added,
        removedNodes: [],
      }) as unknown as MutationRecord;
    expect(seeingMutation(record([text, plain]))).toBe(false);
    expect(seeingMutation(record([dialog]))).toBe(true);
    const wrapper = document.createElement("section");
    wrapper.append(dialog);
    expect(seeingMutation(record([wrapper]))).toBe(true);
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
