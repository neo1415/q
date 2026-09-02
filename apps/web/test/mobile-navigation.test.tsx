// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileNavigation } from "../src/components/app-shell/mobile-navigation";
import {
  isActiveRoute,
  MOBILE_NAVIGATION,
} from "../src/components/app-shell/navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/discover",
}));

describe("MobileNavigation", () => {
  it("is the Primary landmark with exactly four labelled tabs", () => {
    render(<MobileNavigation />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(4);
    expect([...links].map((link) => link.textContent)).toEqual([
      "Home",
      "Discover",
      "Capital",
      "Profile",
    ]);
  });

  it("marks the current route with aria-current and nothing else", () => {
    render(<MobileNavigation />);
    expect(
      screen
        .getByRole("link", { name: "Discover" })
        .getAttribute("aria-current"),
    ).toBe("page");
    for (const name of ["Home", "Capital", "Profile"]) {
      expect(
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ).toBe(false);
    }
  });

  it("treats nested routes as active without cross-matching prefixes", () => {
    expect(isActiveRoute("/capital/objectives/1", "/capital")).toBe(true);
    expect(isActiveRoute("/capitalisation", "/capital")).toBe(false);
    expect(MOBILE_NAVIGATION.map((item) => item.href)).toEqual([
      "/home",
      "/discover",
      "/capital",
      "/profile",
    ]);
  });
});
