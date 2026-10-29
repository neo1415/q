// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MobileMenu,
  MobileNavigation,
  YouSheet,
} from "../src/components/app-shell/mobile-navigation";
import {
  ACCOUNT_NAVIGATION,
  isActiveRoute,
  MOBILE_NAVIGATION,
  sectionsFor,
  youSectionsFor,
} from "../src/components/app-shell/navigation";

let pathname = "/discover";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

const SCOPES = ["founder_private", "investor_private", "unset"] as const;

describe("MobileNavigation (option B, owner 2026-10-18)", () => {
  it("is the Primary landmark with five tabs, Work last in place of More", () => {
    pathname = "/discover";
    render(<MobileNavigation />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((link) => link.textContent)).toEqual([
      "Discover",
      "Explore",
      "Q",
      "CRM",
      "Work",
    ]);
    expect(within(nav).queryByRole("button", { name: "More" })).toBeNull();
    expect(within(nav).queryByRole("button")).toBeNull();
  });

  it.each(SCOPES)(
    "lists exactly the desktop sidebar's sections for %s (tabs + You)",
    (scope) => {
      // Desktop: the sidebar's sections, then Profile and Settings in its foot.
      const desktop = [...sectionsFor(scope), ...ACCOUNT_NAVIGATION].map(
        (item) => `${item.label} ${item.href}`,
      );
      const mobile = [...MOBILE_NAVIGATION, ...youSectionsFor(scope)].map(
        (item) => `${item.label} ${item.href}`,
      );
      expect([...mobile].sort()).toEqual([...desktop].sort());
      expect(new Set(mobile).size).toBe(mobile.length);
    },
  );

  it("the tab bar is on Discover only (owner 2026-10-29); elsewhere the menu", () => {
    pathname = "/discover";
    const onDiscover = render(<MobileNavigation />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    onDiscover.unmount();
    for (const path of ["/home", "/work", "/crm", "/explore"]) {
      pathname = path;
      const { container, unmount } = render(<MobileNavigation />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("the menu marks Work current on every Work tab's own address", () => {
    for (const path of [
      "/work",
      "/documents",
      "/pitch",
      "/company/data-room",
      "/rehearsals",
      "/daily",
    ]) {
      pathname = path;
      const { unmount } = render(<MobileMenu />);
      fireEvent.click(screen.getByRole("button", { name: /Menu/u }));
      expect(
        screen.getByRole("link", { name: "Work" }).getAttribute("aria-current"),
      ).toBe("page");
      unmount();
    }
  });

  it("opens the You sheet with what More held and marks the current page", () => {
    pathname = "/settings";
    render(<YouSheet scope="founder_private" admin />);
    const you = screen.getByRole("button", { name: "You" });
    // The button holding the current page reads as current too.
    expect(you.getAttribute("aria-current")).toBe("true");
    fireEvent.click(you);
    const sheet = screen.getByRole("navigation", { name: "Your sections" });
    const hrefs = [...sheet.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toEqual(
      youSectionsFor("founder_private", { admin: true }).map(
        (item) => item.href,
      ),
    );
    expect(hrefs).toEqual([
      "/profile",
      "/settings/usage",
      "/settings",
      "/admin",
    ]);
    expect(
      within(sheet)
        .getByRole("link", { name: /^Settings/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    // Appearance and sign-out stay reachable on a phone.
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });

  it("marks the current route with aria-current and nothing else", () => {
    pathname = "/discover";
    render(<MobileNavigation />);
    expect(
      screen
        .getByRole("link", { name: "Discover" })
        .getAttribute("aria-current"),
    ).toBe("page");
    for (const name of ["Q", "Explore", "CRM", "Work"]) {
      expect(
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ).toBe(false);
    }
  });

  it("treats nested routes as active without cross-matching prefixes", () => {
    expect(isActiveRoute("/capital/objectives/1", "/capital")).toBe(true);
    expect(isActiveRoute("/capitalisation", "/capital")).toBe(false);
    expect(isActiveRoute("/dailyx", "/work")).toBe(false);
    expect(isActiveRoute("/q-pitch", "/work")).toBe(false);
    // Explore on the phone (ADR 0055); Capital is the CRM's tab.
    expect(MOBILE_NAVIGATION.map((item) => item.href)).toEqual([
      "/discover",
      "/explore",
      "/home",
      "/relationships",
      "/work",
    ]);
  });
});
