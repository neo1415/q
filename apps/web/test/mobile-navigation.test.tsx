// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileNavigation } from "../src/components/app-shell/mobile-navigation";
import {
  ACCOUNT_NAVIGATION,
  isActiveRoute,
  MOBILE_NAVIGATION,
  moreSectionsFor,
  sectionsFor,
} from "../src/components/app-shell/navigation";

let pathname = "/discover";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

const SCOPES = ["founder_private", "investor_private", "unset"] as const;

describe("MobileNavigation", () => {
  it("is the Primary landmark with four tabs and More", () => {
    pathname = "/discover";
    render(<MobileNavigation />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((link) => link.textContent)).toEqual([
      "Discover",
      "Relationships",
      "Q",
      "Capital",
    ]);
    expect(within(nav).getByRole("button", { name: "More" })).toBeTruthy();
  });

  it.each(SCOPES)(
    "lists exactly the desktop sidebar's sections for %s (tabs + More)",
    (scope) => {
      // Desktop: the sidebar's sections, then Profile and Settings in its foot.
      const desktop = [...sectionsFor(scope), ...ACCOUNT_NAVIGATION].map(
        (item) => `${item.label} ${item.href}`,
      );
      const mobile = [...MOBILE_NAVIGATION, ...moreSectionsFor(scope)].map(
        (item) => `${item.label} ${item.href}`,
      );
      expect([...mobile].sort()).toEqual([...desktop].sort());
      expect(new Set(mobile).size).toBe(mobile.length);
    },
  );

  it("opens the More sheet with every other section and marks the current page", () => {
    pathname = "/daily";
    render(<MobileNavigation scope="founder_private" />);
    const more = screen.getByRole("button", { name: "More" });
    // The tab holding the current page reads as current too.
    expect(more.getAttribute("aria-current")).toBe("true");
    fireEvent.click(more);
    const sheet = screen.getByRole("navigation", { name: "More sections" });
    const labels = [...sheet.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(labels).toEqual(
      moreSectionsFor("founder_private").map((item) => item.href),
    );
    expect(labels).toContain("/rehearsals");
    expect(labels).toContain("/results");
    expect(
      within(sheet)
        .getByRole("link", { name: /The Q Daily/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
  });

  it("marks the current route with aria-current and nothing else", () => {
    pathname = "/discover";
    render(<MobileNavigation />);
    expect(
      screen
        .getByRole("link", { name: "Discover" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "More" }).hasAttribute("aria-current"),
    ).toBe(false);
    for (const name of ["Q", "Capital", "Relationships"]) {
      expect(
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ).toBe(false);
    }
  });

  it("treats nested routes as active without cross-matching prefixes", () => {
    expect(isActiveRoute("/capital/objectives/1", "/capital")).toBe(true);
    expect(isActiveRoute("/capitalisation", "/capital")).toBe(false);
    expect(MOBILE_NAVIGATION.map((item) => item.href)).toEqual([
      "/discover",
      "/relationships",
      "/home",
      "/capital",
    ]);
  });
});
