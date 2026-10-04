// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_COLORS } from "@capital-q/ui/tokens";

import manifest from "../app/manifest";
import {
  INSTALL_DISMISSED_KEY,
  installOffer,
  isIosSafari,
  readDismissed,
} from "../src/pwa/install-state";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/features/q-dock", () => ({ useDockAvoid: () => undefined }));

const { InstallPrompt } = await import("../src/pwa/install-prompt");

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

function publicFile(path: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../public", path);
}

describe("web app manifest", () => {
  const m = manifest();

  it("is installable: name, short name, standalone, scope and start flagged as an installed launch (never the landing)", () => {
    expect(m.name).toBe("Capital Q");
    expect(m.short_name).toBe("Capital Q");
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe("/");
    expect(m.start_url).toBe("/?source=pwa");
  });

  it("takes its theme colour from the tokens and launches on the splash's navy", () => {
    expect(m.theme_color).toBe(THEME_COLORS.light.canvas);
    // The OS launch screen matches the particle splash that follows it.
    expect(m.background_color).toBe("#030916");
  });

  it("ships 192 and 512 PNG icons and a maskable one, all present on disk", () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(existsSync(publicFile(icon.src))).toBe(true);
    }
    expect(existsSync(publicFile("/icons/apple-touch-icon.png"))).toBe(true);
  });

  it("offers Discover and Ask Q as shortcuts inside its scope", () => {
    expect(m.shortcuts?.map((s) => [s.name, s.url])).toEqual([
      ["Discover", "/discover"],
      ["Ask Q", "/home"],
    ]);
  });

  it("has a self-contained offline page with no colour values of its own", () => {
    const html = readFileSync(publicFile("/offline.html"), "utf8");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/<script|<link[^>]+stylesheet|_next\//);
  });
});

describe("when to offer installing", () => {
  const base = {
    standalone: false,
    dismissed: false,
    deferredPrompt: false,
    userAgent: ANDROID_CHROME,
    maxTouchPoints: 5,
    pathname: "/home",
  };

  it("offers the browser's prompt only once the browser said it may", () => {
    expect(installOffer(base)).toBe("NONE");
    expect(installOffer({ ...base, deferredPrompt: true })).toBe("PROMPT");
  });

  it("hints Add to Home Screen on iOS Safari only", () => {
    expect(installOffer({ ...base, userAgent: IPHONE })).toBe("IOS_HINT");
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    // iPadOS reports a Mac.
    expect(
      isIosSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        5,
      ),
    ).toBe(true);
  });

  it("never offers once installed, once dismissed, or over the Discover feed", () => {
    const eligible = { ...base, deferredPrompt: true };
    expect(installOffer({ ...eligible, standalone: true })).toBe("NONE");
    expect(installOffer({ ...eligible, dismissed: true })).toBe("NONE");
    expect(installOffer({ ...eligible, pathname: "/discover" })).toBe("NONE");
  });

  it("treats unreadable storage as not dismissed, without throwing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readDismissed(throwing)).toBe(false);
  });
});

describe("the install prompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pathname = "/home";
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => IPHONE,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({ matches: false }),
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("shows the iOS hint once, and never again after it is dismissed", () => {
    render(<InstallPrompt />);
    expect(
      screen.getByRole("region", { name: "Install Capital Q" }).textContent,
    ).toContain("Add to Home Screen");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "Install Capital Q" })).toBe(
      null,
    );
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe("1");

    cleanup();
    render(<InstallPrompt />);
    expect(screen.queryByRole("region", { name: "Install Capital Q" })).toBe(
      null,
    );
  });

  it("holds the browser's prompt and calls it only when asked", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => ANDROID_CHROME,
    });
    render(<InstallPrompt />);
    expect(screen.queryByRole("region", { name: "Install Capital Q" })).toBe(
      null,
    );

    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" as const }),
      },
    );
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Install Capital Q" })).toBe(
      null,
    );
  });

  it("stays off the Discover feed", () => {
    pathname = "/discover";
    render(<InstallPrompt />);
    expect(screen.queryByRole("region", { name: "Install Capital Q" })).toBe(
      null,
    );
  });
});
