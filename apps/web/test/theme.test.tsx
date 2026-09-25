// @vitest-environment jsdom
import { runInNewContext } from "node:vm";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_COLORS } from "@capital-q/ui/tokens";

import {
  applyTheme,
  THEME_BOOT_SCRIPT,
  THEME_COLOR_META_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEME_SWITCHING_ATTRIBUTE,
} from "../src/features/appearance/theme";
import { ThemeToggle } from "../src/features/appearance/theme-toggle";

/**
 * The theme switch (ADR 0017 F4): the choice is applied before paint, the
 * browser bar follows a manual choice, "Device" hands both back to the
 * media query, the switch itself runs no transitions, and a choice made in
 * another tab arrives here.
 */

function chosenThemeColor(): string | null {
  return (
    document.head
      .querySelector(`meta[${THEME_COLOR_META_ATTRIBUTE}]`)
      ?.getAttribute("content") ?? null
  );
}

/** The meta a browser reads: the first theme-color tag in the document. */
function firstThemeColorMeta(): Element | null {
  return document.head.querySelector('meta[name="theme-color"]');
}

function runBootScript(): void {
  // The same text the root layout inlines into <head>, run against this
  // document the way the browser runs it: with only the globals it uses.
  runInNewContext(THEME_BOOT_SCRIPT, {
    localStorage: window.localStorage,
    document,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.replaceChildren();
  // What Next renders from the viewport export: device-following tags.
  for (const [media, color] of [
    ["(prefers-color-scheme: light)", THEME_COLORS.light.canvas],
    ["(prefers-color-scheme: dark)", THEME_COLORS.dark.canvas],
  ] as const) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("media", media);
    meta.setAttribute("content", color);
    document.head.append(meta);
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("theme boot script", () => {
  it("applies a stored dark choice and a dark browser bar before paint", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runBootScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(chosenThemeColor()).toBe(THEME_COLORS.dark.canvas);
    // Prepended, so it wins over the device-following tags.
    expect(
      firstThemeColorMeta()?.hasAttribute(THEME_COLOR_META_ATTRIBUTE),
    ).toBe(true);
  });

  it("leaves an unchosen document to the device", () => {
    runBootScript();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(chosenThemeColor()).toBeNull();
  });

  it("ignores a value it does not recognise", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    runBootScript();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(chosenThemeColor()).toBeNull();
  });
});

describe("applyTheme", () => {
  it("moves the browser bar with a manual choice and hands it back for Device", () => {
    applyTheme("light");
    expect(chosenThemeColor()).toBe(THEME_COLORS.light.canvas);
    applyTheme("dark");
    expect(chosenThemeColor()).toBe(THEME_COLORS.dark.canvas);
    expect(
      document.head.querySelectorAll(`meta[${THEME_COLOR_META_ATTRIBUTE}]`),
    ).toHaveLength(1);
    applyTheme("system");
    expect(chosenThemeColor()).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    // The device-following tags are untouched.
    expect(
      document.head.querySelectorAll('meta[name="theme-color"][media]'),
    ).toHaveLength(2);
  });

  it("holds transitions off for the switch and releases them after", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    applyTheme("dark");
    expect(
      document.documentElement.hasAttribute(THEME_SWITCHING_ATTRIBUTE),
    ).toBe(true);
    // One frame: the switch is still being painted without transitions.
    vi.advanceTimersToNextFrame();
    expect(
      document.documentElement.hasAttribute(THEME_SWITCHING_ATTRIBUTE),
    ).toBe(true);
    vi.advanceTimersToNextFrame();
    expect(
      document.documentElement.hasAttribute(THEME_SWITCHING_ATTRIBUTE),
    ).toBe(false);
  });
});

describe("ThemeToggle", () => {
  it("offers Light, Match device and Dark by name, and marks the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle display="icons" />);
    const group = screen.getByRole("group", { name: "Theme" });
    const names = [...group.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Light", "Match device", "Dark"]);
    expect(
      screen
        .getByRole("button", { name: "Match device" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Match device" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("follows a choice made in another tab", () => {
    render(<ThemeToggle display="icons" />);
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
      );
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(chosenThemeColor()).toBe(THEME_COLORS.light.canvas);
    expect(
      screen
        .getByRole("button", { name: "Light" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
