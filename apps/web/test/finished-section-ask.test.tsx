// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Lane ov live check 2026-10-16: a founder whose setup is finished opened
 * a profile gap's "Tell Q" and landed on "Founder setup is complete" with
 * no question. The finished screen now names the section, asks its
 * question and hands it to Q on Home, typed for them, never sent.
 */

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined }),
}));

const { FinishedSectionAsk } =
  await import("../src/features/founder-onboarding/founder-onboarding-screen");

afterEach(cleanup);

describe("a finished setup, opened at a profile section", () => {
  it("asks that section's question and opens Q with it", () => {
    render(<FinishedSectionAsk sectionKey="moats" />);
    expect(screen.getByRole("heading", { name: "Moats" })).toBeTruthy();
    expect(
      screen.getByText("What makes your position hard to copy?"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Tell Q" }).getAttribute("href"),
    ).toBe(
      `/home?ask=${encodeURIComponent("For my profile's Moats section: ")}`,
    );
  });

  it("says nothing for a key the section list does not have", () => {
    const { container } = render(<FinishedSectionAsk sectionKey="nope" />);
    expect(container.textContent).toBe("");
  });
});
