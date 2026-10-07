// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Collapsible navigation groups (founder direction 2026-10-07): every
 * labelled group in the sidebar is a disclosure, closed by default; the
 * group holding the current page opens on arrival; the person's choice is
 * remembered per group, and storage failing never breaks the sidebar.
 */

let pathname = "/discover";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/features/q/active-conversation", () => ({
  useHomeHref: () => "/home",
  forgetActiveConversations: () => undefined,
}));

const { DesktopSidebar } =
  await import("../src/components/app-shell/desktop-sidebar");
const { NAV_GROUPS_STORAGE_KEY, parseGroupChoices, resetGroupChoicesForTest } =
  await import("../src/components/app-shell/nav-group-state");

const INVESTOR = { scope: "investor_private", label: "Zino Aviation" } as const;

function toggle(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  pathname = "/discover";
  window.localStorage.clear();
  resetGroupChoicesForTest();
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sidebar groups", () => {
  it("are disclosures, closed by default on a first visit", () => {
    render(<DesktopSidebar context={INVESTOR} />);
    for (const name of ["Workspace", "You"]) {
      const button = toggle(name);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      const list = document.getElementById(
        button.getAttribute("aria-controls") ?? "",
      );
      expect(list?.hidden).toBe(true);
    }
    expect(screen.queryByRole("link", { name: /^Work/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    // The main areas have no label and never fold.
    expect(screen.getByRole("link", { name: "Discover" })).toBeTruthy();
  });

  it("open and close by button, and remember the choice per group", async () => {
    const first = render(<DesktopSidebar context={INVESTOR} />);
    await userEvent.click(toggle("You"));
    expect(toggle("You").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(toggle("Workspace").getAttribute("aria-expanded")).toBe("false");
    expect(
      parseGroupChoices(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY)),
    ).toEqual({ You: true });

    first.unmount();
    resetGroupChoicesForTest();
    render(<DesktopSidebar context={INVESTOR} />);
    expect(toggle("You").getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle("You"));
    expect(toggle("You").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("open the group holding the current page, without saving it", async () => {
    pathname = "/settings";
    render(<DesktopSidebar context={INVESTOR} />);
    expect(toggle("You").getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(toggle("Workspace").getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY)).toBeNull();
    // The person may still close it.
    await userEvent.click(toggle("You"));
    expect(toggle("You").getAttribute("aria-expanded")).toBe("false");
  });

  it("still work in the folded rail", async () => {
    pathname = "/home";
    render(<DesktopSidebar context={INVESTOR} />);
    const you = toggle("You");
    expect(you.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(you);
    expect(toggle("You").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("work when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<DesktopSidebar context={INVESTOR} />);
    expect(toggle("You").getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle("You"));
    expect(toggle("You").getAttribute("aria-expanded")).toBe("true");
  });

  it("ignore malformed saved choices", () => {
    expect(parseGroupChoices("{not json")).toEqual({});
    expect(parseGroupChoices('{"You":"yes","Workspace":true,"x":1}')).toEqual({
      Workspace: true,
    });
    expect(parseGroupChoices("null")).toEqual({});
  });
});
