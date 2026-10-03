// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPLASH_BOOT_SCRIPT,
  SPLASH_DONE_EVENT,
  SPLASH_SEEN_KEY,
  splashSkippedFor,
} from "../src/features/splash/splash-policy";

/**
 * The cold-start splash (founder handoff revision 3): once per session,
 * never on an auth return or a public card, skippable at once, and it
 * tells the page when it has gone.
 */

const controller = {
  destroy: vi.fn(),
  replay: vi.fn(),
  setTheme: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  finish: vi.fn(),
};
let complete: (() => void) | undefined;
vi.mock("../src/features/splash/splash-engine", () => ({
  createCapitalQSplash: (
    _root: HTMLElement,
    options: { onComplete?: () => void },
  ) => {
    complete = options.onComplete;
    return controller;
  },
}));

const { SplashOverlay } = await import("../src/features/splash/splash-overlay");

function boot(path: string) {
  window.history.replaceState(null, "", path);
  const off = splashSkippedFor(
    path,
    sessionStorage.getItem(SPLASH_SEEN_KEY) !== null,
  );
  if (off) document.documentElement.dataset["splash"] = "off";
  else document.documentElement.removeAttribute("data-splash");
  return document.documentElement.dataset["splash"];
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  complete = undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("when the splash shows", () => {
  it("shows on a cold entry and not again this session", () => {
    expect(boot("/discover")).toBeUndefined();
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    expect(boot("/discover")).toBe("off");
  });

  it("never shows on an auth return or a public card", () => {
    expect(boot("/auth/callback")).toBe("off");
    expect(boot("/u/kivu")).toBe("off");
    // Sign-in is a first screen: it gets the splash.
    expect(boot("/auth/sign-in")).toBeUndefined();
  });

  it("decides in the boot script by the same rule", () => {
    expect(SPLASH_BOOT_SCRIPT).toContain(SPLASH_SEEN_KEY);
    for (const prefix of ["/auth/callback", "/u/", "/c/", "/@"]) {
      expect(SPLASH_BOOT_SCRIPT).toContain(JSON.stringify(prefix));
    }
  });
});

describe("the splash", () => {
  it("leaves after the Q forms, remembers it, and tells the page", () => {
    boot("/discover");
    const done = vi.fn();
    window.addEventListener(SPLASH_DONE_EVENT, done);
    const { container } = render(<SplashOverlay />);
    expect(container.querySelector(".cq-splash")).not.toBeNull();
    act(() => {
      complete?.();
      vi.advanceTimersByTime(1_000);
    });
    expect(container.querySelector(".cq-splash")).toBeNull();
    expect(sessionStorage.getItem(SPLASH_SEEN_KEY)).toBe("1");
    expect(done).toHaveBeenCalledTimes(1);
    window.removeEventListener(SPLASH_DONE_EVENT, done);
  });

  it("hands over within 2 s of the Q forming, says it can be skipped, and shouts nothing", () => {
    boot("/discover");
    const { container } = render(<SplashOverlay />);
    expect(container.textContent).toContain("Tap to skip");
    // Sentence case: no all-caps words in the lockup (CLAUDE.md eyebrows).
    expect(container.textContent).not.toMatch(/\b[A-Z]{3,}\b/);
    act(() => {
      complete?.();
      vi.advanceTimersByTime(600);
    });
    expect(container.querySelector(".cq-splash")).toBeNull();
  });

  it("is skipped at once by a key", () => {
    boot("/discover");
    const { container } = render(<SplashOverlay />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelector(".cq-splash")).toBeNull();
  });
});
