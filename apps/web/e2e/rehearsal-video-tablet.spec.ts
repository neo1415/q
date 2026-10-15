import { expect, test, type Page } from "@playwright/test";

/**
 * Tablet video rehearsal (owner report 2026-10-15). Drives the real video
 * stage and voice room on /dev/rehearsal-video over a fictional rehearsal at
 * iPad sizes in both orientations, plus a 390 px phone. The provider room is
 * an empty frame: no rehearsal is created, no Tavus room is allocated and no
 * request leaves this server.
 */

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SIZES = [
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** Every request stays on this server: nothing reaches a provider or Q. */
async function guardOffline(page: Page): Promise<string[]> {
  // A first load shows the brand splash over everything; a returning tab
  // (this key) does not, and the room is what is under test here.
  await page.addInitScript(() => {
    sessionStorage.setItem("cq.splash.seen", "1");
  });
  // The voice room asks the server to open its line; with nobody signed in
  // that would bounce the page to sign-in. Layout is what is under test.
  await page.route("**/dev/rehearsal-video**", (route) =>
    route.request().method() === "POST" &&
    route.request().headers()["next-action"] !== undefined
      ? route.abort()
      : route.continue(),
  );
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.protocol.startsWith("http")
    )
      outside.push(url.origin);
  });
  return outside;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
}

async function inViewport(page: Page, name: string | RegExp): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("No viewport");
  const button = page.getByRole("button", { name });
  // Labels flip as the line settles (microphone on/off); measure once stable.
  await expect(button).toBeVisible();
  await expect
    .poll(async () => {
      const box = await button.boundingBox();
      return (
        box !== null &&
        box.x >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height
      );
    })
    .toBe(true);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
      isMobile: true,
      userAgent: IPAD_UA,
    });

    test("the video stage shows the provider tile, uncovered, with camera and microphone delegated", async ({
      page,
    }) => {
      const outside = await guardOffline(page);
      await page.goto("/dev/rehearsal-video?view=stage");
      const tile = page.locator('iframe[title^="Video rehearsal with"]');
      await expect(tile).toBeVisible();
      const allow = (await tile.getAttribute("allow")) ?? "";
      expect(allow).toContain("camera");
      expect(allow).toContain("microphone");
      // Nothing (shell navigation, Q, install hints) sits over the tile.
      const covered = await tile.evaluate((frame) => {
        const box = frame.getBoundingClientRect();
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return top !== frame;
      });
      expect(covered).toBe(false);
      const box = await tile.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(240);
      await inViewport(page, "End and see my review");
      await inViewport(page, "Carry on by voice instead");
      await noHorizontalOverflow(page);
      expect(outside).toEqual([]);
    });

    test("the voice room keeps every call control on screen, Leave included", async ({
      page,
    }) => {
      const outside = await guardOffline(page);
      await page.goto("/dev/rehearsal-video?view=room");
      await expect(
        page.getByRole("button", { name: "Leave the rehearsal" }),
      ).toBeVisible();
      for (const name of [
        /^Turn (on|off) microphone$/,
        /^Turn (on|off) camera$/,
        "More options",
        "Leave the rehearsal",
      ])
        await inViewport(page, name);
      await noHorizontalOverflow(page);
      expect(outside).toEqual([]);
    });
  });
}
