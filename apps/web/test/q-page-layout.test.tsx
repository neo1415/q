// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Q page's layout defaults (R24).
 *
 * - On the Q page every side bar starts collapsed: the desktop sidebar is a
 *   rail, and the Board is closed.
 * - Elsewhere the sidebar starts open.
 * - The Board no longer opens by itself: what Q makes is in the chat
 *   thread, inline (founder direction A, 2026-09-28).
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
  forgetActiveConversations: () => undefined,
}));

const { DesktopSidebar } =
  await import("../src/components/app-shell/desktop-sidebar");
const { sidebarCollapsed } =
  await import("../src/components/app-shell/sidebar-state");

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
    // Chats live on the Q page, never in the sidebar (2026-09-29).
    expect(screen.queryByTestId("chats-list")).toBeNull();
    expect(screen.queryByRole("link", { name: "New chat" })).toBeNull();

    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(aside?.hasAttribute("data-collapsed")).toBe(false);
    expect(screen.queryByTestId("chats-list")).toBeNull();
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
    expect(screen.queryByTestId("chats-list")).toBeNull();
  });

  it("offers the theme as one icon, not three segments", () => {
    render(<DesktopSidebar context={INVESTOR} />);
    expect(screen.getByRole("button", { name: /^Theme: / })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });

  it("keeps Sign out in its footer, where people look for it", () => {
    render(<DesktopSidebar context={INVESTOR} />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("never scrolls sideways: the rail clamps its nav and stacks its footer", async () => {
    const { container } = render(<DesktopSidebar context={INVESTOR} />);
    const nav = container.querySelector("[data-sidebar-nav]");
    const footer = container.querySelector("[data-sidebar-footer]");
    // Folded (the Q page): no side padding to squeeze the 44 px icons,
    // and the footer's controls in one column.
    expect(nav?.className).toContain("overflow-x-hidden");
    expect(nav?.className).toContain("px-0");
    expect(footer?.className).toContain("overflow-x-hidden");
    expect(footer?.lastElementChild?.className).toContain("flex-col");

    await userEvent.click(
      screen.getByRole("button", { name: "Expand sidebar" }),
    );
    // Open: still clamped; the controls sit in a row under the scope.
    expect(nav?.className).toContain("overflow-x-hidden");
    expect(footer?.lastElementChild?.className).not.toContain("flex-col");
  });
});
