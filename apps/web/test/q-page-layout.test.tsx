// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QTurn } from "../src/features/q/conversation";

/**
 * The Q page's layout defaults (R24).
 *
 * - On the Q page every side bar starts collapsed: the desktop sidebar is a
 *   rail, and the Board is closed.
 * - Elsewhere the sidebar starts open.
 * - The Board opens by itself only when Q makes a file in this visit;
 *   documents already in a restored conversation do not open it.
 */

let pathname = "/home";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/features/q/chats-list", () => ({
  ChatsListForRoute: () => <div data-testid="chats-list" />,
}));
vi.mock("../src/features/q/active-conversation", () => ({
  useHomeHref: () => "/home",
}));

const { DesktopSidebar } =
  await import("../src/components/app-shell/desktop-sidebar");
const { sidebarCollapsed } =
  await import("../src/components/app-shell/sidebar-state");
const { artifactIdsIn, freshArtifact, useBoardAutoOpen } =
  await import("../src/features/q/board-open");

beforeEach(() => {
  pathname = "/home";
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});

const INVESTOR = { scope: "investor_private", label: "Zino Aviation" } as const;

describe("R24 · the sidebar", () => {
  it("starts collapsed on the Q page and open elsewhere", () => {
    expect(sidebarCollapsed("/home", null)).toBe(true);
    expect(sidebarCollapsed("/discover", null)).toBe(false);
    expect(sidebarCollapsed("/profile", null)).toBe(false);
  });

  it("keeps a choice only for the kind of page it was made on", () => {
    const openedOnQ = { onQ: true, collapsed: false };
    expect(sidebarCollapsed("/home", openedOnQ)).toBe(false);
    expect(sidebarCollapsed("/discover", openedOnQ)).toBe(false);
    const foldedElsewhere = { onQ: false, collapsed: true };
    expect(sidebarCollapsed("/capital", foldedElsewhere)).toBe(true);
    expect(sidebarCollapsed("/home", foldedElsewhere)).toBe(true);
  });

  it("renders as a rail on the Q page, with no separate Ask Q entry", async () => {
    const { container } = render(<DesktopSidebar context={INVESTOR} />);
    const aside = container.querySelector("[data-sidebar]");
    expect(aside?.hasAttribute("data-collapsed")).toBe(true);
    expect(screen.queryByText("Ask Q")).toBeNull();
    expect(screen.queryByTestId("chats-list")).toBeNull();
    // The conversations control, folded: New chat and the list.
    expect(screen.getByRole("link", { name: "New chat" })).toBeTruthy();

    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(aside?.hasAttribute("data-collapsed")).toBe(false);
    expect(screen.getByTestId("chats-list")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Collapse sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("is open on other pages", () => {
    pathname = "/discover";
    const { container } = render(<DesktopSidebar context={INVESTOR} />);
    expect(
      container.querySelector("[data-sidebar]")?.hasAttribute("data-collapsed"),
    ).toBe(false);
    expect(screen.getByTestId("chats-list")).toBeTruthy();
  });

  it("offers the theme as one icon, not three segments", () => {
    render(<DesktopSidebar context={INVESTOR} />);
    expect(screen.getByRole("button", { name: /^Theme: / })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });
});

function answer(id: string, artifactIds: readonly string[]): QTurn {
  return {
    kind: "Q",
    id,
    text: "Here it is.",
    streaming: false,
    sourceCount: 0,
    findings: [],
    uncertainties: [],
    blocks: artifactIds.map((artifactId) => ({
      kind: "ARTIFACT_REFERENCE" as const,
      artifactId,
      type: "INVESTMENT_MEMO" as const,
      status: "READY" as const,
      title: "Memo",
    })),
  } as unknown as QTurn;
}

const ASK: QTurn = {
  kind: "PERSON",
  id: "p1",
  text: "Make me a memo",
  unconfirmed: false,
};

describe("R24 · the Board opens by itself only for a new file", () => {
  it("finds the artifacts a conversation points at", () => {
    const turns = [ASK, answer("q1", ["a1"]), answer("q2", ["a2", "a1"])];
    expect([...artifactIdsIn(turns)]).toEqual(["a1", "a2"]);
    expect(freshArtifact(new Set(["a1"]), turns)).toBe("a2");
    expect(freshArtifact(new Set(["a1", "a2"]), turns)).toBeUndefined();
  });

  it("opens when Q makes a document during the visit", () => {
    const onFresh = vi.fn();
    const { rerender } = renderHook(
      ({ turns }: { turns: readonly QTurn[] }) => {
        useBoardAutoOpen({
          turns,
          loading: false,
          conversationId: null,
          onFresh,
        });
      },
      { initialProps: { turns: [] as readonly QTurn[] } },
    );
    act(() => {
      rerender({ turns: [ASK, answer("q1", [])] });
    });
    expect(onFresh).not.toHaveBeenCalled();
    act(() => {
      rerender({ turns: [ASK, answer("q1", []), answer("q2", ["deck-1"])] });
    });
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(onFresh).toHaveBeenCalledWith("deck-1");
    // The same document again is not a new file.
    act(() => {
      rerender({
        turns: [ASK, answer("q1", []), answer("q2", ["deck-1"]), ASK],
      });
    });
    expect(onFresh).toHaveBeenCalledTimes(1);
  });

  it("does not open for documents already in a restored conversation", () => {
    const onFresh = vi.fn();
    const restored = [ASK, answer("q1", ["old-memo"])];
    const { rerender } = renderHook(
      ({ turns, loading }: { turns: readonly QTurn[]; loading: boolean }) => {
        useBoardAutoOpen({
          turns,
          loading,
          conversationId: "c1",
          onFresh,
        });
      },
      { initialProps: { turns: [] as readonly QTurn[], loading: true } },
    );
    act(() => {
      rerender({ turns: restored, loading: false });
    });
    expect(onFresh).not.toHaveBeenCalled();
    act(() => {
      rerender({
        turns: [...restored, answer("q2", ["new-deck"])],
        loading: false,
      });
    });
    expect(onFresh).toHaveBeenCalledWith("new-deck");
  });
});
