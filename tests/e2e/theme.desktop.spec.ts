import { expect, test, type Page } from "@playwright/test";

/**
 * The theme switch (ADR 0017 F4; UX-07 acceptance). Visible without opening
 * a menu, applied before the first frame, carried to the browser bar and to
 * other tabs, free of transitions while it switches, and without effect on
 * the stage surfaces, which are one night in either theme.
 */

const DARK_CANVAS = "#0b0d12";
const LIGHT_CANVAS = "#fbfaf7";

/** The theme-color a browser reads: the first matching tag in <head>. */
async function browserBarColour(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (const meta of document.head.querySelectorAll(
      'meta[name="theme-color"]',
    )) {
      const media = meta.getAttribute("media");
      if (media === null || window.matchMedia(media).matches) {
        return meta.getAttribute("content");
      }
    }
    return null;
  });
}

test.describe("theme switch, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is on the auth header without opening anything", async ({ page }) => {
    await page.goto("/auth/sign-in");
    const theme = page.getByRole("banner").getByRole("group", {
      name: "Theme",
    });
    await expect(theme).toBeVisible();
    for (const name of ["Light", "Match device", "Dark"]) {
      await expect(theme.getByRole("button", { name })).toBeVisible();
    }
  });

  test("a stored dark choice on a light device paints no light frame", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: "light",
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("cq.theme", "dark");
      // The first animation frame runs before the first paint: whatever
      // the document looks like here is what the person first sees.
      window.requestAnimationFrame(() => {
        const body = document.body;
        (window as unknown as Record<string, unknown>).__firstFrame = {
          theme: document.documentElement.getAttribute("data-theme"),
          scheme: getComputedStyle(document.documentElement).colorScheme,
          background:
            body === null ? null : getComputedStyle(body).backgroundColor,
        };
      });
    });
    await page.goto("/auth/sign-in");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as Record<string, unknown>).__firstFrame,
        ),
      )
      .toBeTruthy();
    const first = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__firstFrame,
    )) as { theme: string; scheme: string; background: string | null };
    const settled = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(first.theme).toBe("dark");
    expect(first.scheme).toBe("dark");
    expect(first.background).toBe(settled);
    expect(await browserBarColour(page)).toBe(DARK_CANVAS);
    await context.close();
  });

  test("switches without transitions, moves the browser bar, reaches other tabs, and leaves the stage alone", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: "light",
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const other = await context.newPage();
    await page.goto("/auth/sign-in");
    await other.goto("/auth/sign-in");
    // Hydrated, so the control answers the key press below.
    await page.waitForLoadState("networkidle");
    await other.waitForLoadState("networkidle");
    expect(await browserBarColour(page)).toBe(LIGHT_CANVAS);

    // A stage surface, as the voice stage and Discover render it.
    const stageBackground = () =>
      page.evaluate(() => {
        let stage = document.getElementById("probe-stage");
        if (stage === null) {
          stage = document.createElement("div");
          stage.id = "probe-stage";
          stage.className = "cq-stage";
          document.body.append(stage);
        }
        return getComputedStyle(stage).backgroundColor;
      });
    const stageInLight = await stageBackground();

    // Count every transition that starts from the moment of the switch.
    await page.evaluate(() => {
      const record = window as unknown as Record<string, unknown>;
      record.__transitions = 0;
      document.addEventListener(
        "transitionrun",
        (event: TransitionEvent) => {
          // The development overlay is not the application.
          if (
            event.target instanceof Element &&
            event.target.closest("nextjs-portal") !== null
          ) {
            return;
          }
          record.__transitions = (record.__transitions as number) + 1;
        },
        true,
      );
    });
    // By keyboard, so no hover transition starts before the switch.
    await page.getByRole("button", { name: "Dark" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__transitions,
      ),
    ).toBe(0);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await browserBarColour(page)).toBe(DARK_CANVAS);
    expect(await stageBackground()).toBe(stageInLight);

    // The other tab follows.
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await browserBarColour(other)).toBe(DARK_CANVAS);

    // Match device hands both back to the device.
    await page.getByRole("button", { name: "Match device" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await browserBarColour(page)).toBe(LIGHT_CANVAS);
    await context.close();
  });
});

test.describe("theme switch, signed in", () => {
  test("is in the sidebar footer without opening anything", async ({
    page,
  }) => {
    await page.goto("/profile");
    const sidebar = page.getByRole("complementary");
    const theme = sidebar.getByRole("group", { name: "Theme" });
    await expect(theme).toBeVisible();
    const box = await theme.getByRole("button", { name: "Dark" }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  });
});
