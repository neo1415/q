import { expect, test } from "@playwright/test";

/**
 * PWA foundation: manifest identity, icon resolution, service-worker
 * headers and registration, the caching policy as actually applied, and the
 * offline indicator. No install-prompt automation.
 */

const ALLOWED = [
  /\/_next\/static\//,
  /\/icons\//,
  /\/fonts\//,
  /\/manifest\.webmanifest$/,
  /\/icon\.svg$/,
];

test.describe("progressive web application", () => {
  test("serves a valid installable manifest with resolvable icons", async ({
    request,
  }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
      theme_color: string;
      background_color: string;
    };
    expect(manifest.name).toBe("Capital Q");
    expect(manifest.short_name).toBe("Capital Q");
    expect(manifest.start_url).toBe("/home");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    );
    for (const icon of manifest.icons) {
      const asset = await request.get(icon.src);
      expect(asset.ok(), icon.src).toBe(true);
      expect(asset.headers()["content-type"]).toContain("image/png");
    }
  });

  test("serves the service worker with no-cache headers and the page links the manifest", async ({
    page,
    request,
  }) => {
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect(sw.headers()["x-content-type-options"]).toBe("nosniff");

    await page.goto("/home");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      /manifest\.webmanifest/,
    );
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveCount(
      1,
    );
  });

  test("registers the service worker and caches only shell assets", async ({
    page,
  }) => {
    await page.goto("/home");
    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) {
        return "unsupported";
      }
      const registration = await navigator.serviceWorker.ready;
      return registration.active === null ? "inactive" : "active";
    });
    expect(registered).toBe("active");

    // Load a second page under the worker's control, then inspect the cache.
    await page.goto("/discover");
    await page.goto("/home");
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const urls: string[] = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        for (const req of await cache.keys()) {
          urls.push(new URL(req.url).pathname);
        }
      }
      return { keys, urls };
    });
    expect(cached.keys).toEqual(["cq-shell-v1"]);
    for (const url of cached.urls) {
      expect(
        ALLOWED.some((pattern) => pattern.test(url)),
        `unexpected cached URL ${url}`,
      ).toBe(true);
    }
    expect(
      cached.urls.some((url) => url === "/home" || url === "/discover"),
    ).toBe(false);
  });

  test("shows a quiet offline notice and recovers", async ({
    page,
    context,
  }) => {
    await page.goto("/home");
    await context.setOffline(true);
    await expect(
      page.getByRole("status").filter({ hasText: "Offline" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask Q" })).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.getByRole("status").filter({ hasText: "Back online" }),
    ).toBeVisible();
  });
});
