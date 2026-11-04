// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/relationships/company/c1",
}));

const { BackLink, backLinkName } = await import("@/features/company/back-link");
const { markInAppNavigation, markLanding, resetInAppNavigation } =
  await import("@/features/company/back-history");

afterEach(() => {
  cleanup();
  resetInAppNavigation();
  back.mockReset();
});

/** One history entry before this page, as after an in-app move. */
beforeEach(() => {
  window.history.replaceState(null, "", "/relationships/company/c1");
  window.history.pushState(null, "", "/relationships/company/c1");
});

describe("the shared Back control (UX-04)", () => {
  it("says where it goes, and is a real link to the parent", () => {
    render(<BackLink fallbackHref="/relationships" label="CRM" />);
    const link = screen.getByRole("link", { name: "Back to CRM" });
    expect(link.getAttribute("href")).toBe("/relationships");
    expect(link.textContent).toBe("CRM");
    expect(link.hasAttribute("data-back-link")).toBe(true);
  });

  it("reads plainly as Back without a parent's name", () => {
    render(<BackLink fallbackHref="/home" />);
    expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
    expect(backLinkName((english) => english, undefined)).toBe("Back");
  });

  it("is a 44 px target at every width, its arrow mirrored right-to-left", () => {
    render(<BackLink fallbackHref="/work" label="Work" />);
    const link = screen.getByRole("link", { name: "Back to Work" });
    expect(link.className).toContain("min-h-11");
    expect(link.className).not.toMatch(/\blg:h-8\b/u);
    expect(link.querySelector("svg")?.getAttribute("class")).toContain(
      "rtl:rotate-180",
    );
  });

  it("follows the link on a deep link: the tab's first page", () => {
    markLanding("/relationships/company/c1");
    render(<BackLink fallbackHref="/relationships" label="CRM" />);
    const clicked = fireEvent.click(
      screen.getByRole("link", { name: "Back to CRM" }),
    );
    expect(back).not.toHaveBeenCalled();
    // jsdom does not navigate; the default (the link) was left to happen.
    expect(clicked).toBe(true);
  });

  it("goes back in history after a move inside Capital Q", () => {
    markLanding("/relationships");
    markInAppNavigation();
    render(<BackLink fallbackHref="/relationships" label="CRM" />);
    const clicked = fireEvent.click(
      screen.getByRole("link", { name: "Back to CRM" }),
    );
    expect(back).toHaveBeenCalledTimes(1);
    expect(clicked).toBe(false);
  });

  it("leaves a modified click to the browser (a new tab gets the parent)", () => {
    markLanding("/relationships");
    markInAppNavigation();
    render(<BackLink fallbackHref="/relationships" label="CRM" />);
    fireEvent.click(screen.getByRole("link", { name: "Back to CRM" }), {
      metaKey: true,
    });
    expect(back).not.toHaveBeenCalled();
  });
});
