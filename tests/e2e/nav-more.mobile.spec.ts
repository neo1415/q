import { expect, test } from "@playwright/test";

/**
 * The phone's More sheet (founder report, 2026-10-01): every section the
 * desktop sidebar has is reachable on a phone, at the narrowest and widest
 * common widths, in light and dark. Screenshots go to CQ_E2E_SCREENSHOT_DIR
 * when set, else the test's own output folder.
 */

const WIDTHS = [360, 390, 430] as const;
const THEMES = ["light", "dark"] as const;

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`More sheet at ${String(width)} px, ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((choice) => {
        window.localStorage.setItem("cq.theme", choice);
      }, theme);
      await page.goto("/daily");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const nav = page.getByRole("navigation", { name: "Primary" });
      const more = nav.getByRole("button", { name: "More" });
      // The page lives under More, so the More tab reads as current.
      await expect(more).toHaveAttribute("aria-current", "true");
      const tab = await more.boundingBox();
      expect(tab?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(tab?.height ?? 0).toBeGreaterThanOrEqual(44);

      await more.tap();
      const sheet = page.getByRole("navigation", { name: "More sections" });
      await expect(sheet).toBeVisible();
      for (const name of [
        "Profile",
        "Documents",
        "The Q Daily",
        "Search",
        "Settings",
      ]) {
        const link = sheet.getByRole("link", { name: new RegExp(name) });
        await expect(link).toBeVisible();
        const box = await link.boundingBox();
        expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
      }
      await expect(
        sheet.getByRole("link", { name: /The Q Daily/ }),
      ).toHaveAttribute("aria-current", "page");
      const appearance = page.getByRole("group", { name: "Appearance" });
      await expect(appearance).toBeVisible();
      const option = await appearance
        .getByRole("button", { name: "Dark" })
        .boundingBox();
      expect(option?.height ?? 0).toBeGreaterThanOrEqual(44);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const dir = process.env.CQ_E2E_SCREENSHOT_DIR;
      await page.screenshot({
        path:
          dir === undefined
            ? testInfo.outputPath(`more-${String(width)}-${theme}.png`)
            : `${dir}/more-${String(width)}-${theme}.png`,
      });

      // A section opens and the sheet closes behind it.
      await sheet.getByRole("link", { name: "Documents" }).tap();
      await expect(page).toHaveURL(/\/documents$/);
      await expect(sheet).toHaveCount(0);
    });
  }
}
