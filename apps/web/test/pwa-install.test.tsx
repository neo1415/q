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
  INSTALL_DISMISSED_FOR_MS,
  INSTALL_DISMISSED_KEY,
  installOffer,
  isIosSafari,
  readDismissed,
  rememberDismissed,
} from "../src/pwa/install-state";

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/features/q-dock", () => ({ useDockAvoid: () => undefined }));
let session: { turns: readonly unknown[]; q: { working: boolean } } | null =
  null;
vi.mock("@/features/q/q-session", () => ({
  useQSessionOptional: () => session,
}));

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

  it("takes its theme colour from the tokens and launches on the splash's black", () => {
    expect(m.theme_color).toBe(THEME_COLORS.light.canvas);
    // The OS launch screen matches the particle splash that follows it.
    expect(m.background_color).toBe("#0b0a08");
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

  it("never offers on the Q page while a conversation is in progress", () => {
    const eligible = { ...base, deferredPrompt: true };
    expect(installOffer({ ...eligible, conversing: true })).toBe("NONE");
    expect(installOffer({ ...eligible, conversing: false })).toBe("PROMPT");
    // Elsewhere a conversation in the dock does not hide it.
    expect(
      installOffer({ ...eligible, conversing: true, pathname: "/work" }),
    ).toBe("PROMPT");
  });

  it("holds a dismissal for 14 days, then may show once more", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as unknown as Storage;
    const at = Date.UTC(2026, 9, 28);
    expect(readDismissed(storage, at)).toBe(false);
    rememberDismissed(storage, at);
    expect(readDismissed(storage, at)).toBe(true);
    expect(readDismissed(storage, at + INSTALL_DISMISSED_FOR_MS - 1)).toBe(
      true,
    );
    expect(readDismissed(storage, at + INSTALL_DISMISSED_FOR_MS)).toBe(false);
    // The older "for ever" value still counts as dismissed.
    store.set(INSTALL_DISMISSED_KEY, "1");
    expect(readDismissed(storage, at)).toBe(true);
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
    session = null;
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
    expect(
      Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY)),
    ).toBeGreaterThan(0);

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

  it("is a row in the page's flow, not a layer over the composer", () => {
    render(<InstallPrompt />);
    const region = screen.getByRole("region", { name: "Install Capital Q" });
    expect(region.className).toContain("cq-install-row");
    expect(region.className).not.toMatch(/\bfixed\b/);
  });

  it("stays off the Q page while a conversation is going", () => {
    session = { turns: [{}], q: { working: false } };
    render(<InstallPrompt />);
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
