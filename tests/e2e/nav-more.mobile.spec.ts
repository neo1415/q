import { expect, test } from "@playwright/test";

/**
 * Phone navigation after option B (owner 2026-10-18): Work replaced More in
 * the bar, and what More held opens from the You button in the header.
 * Every section the desktop sidebar has stays reachable on a phone, at the
 * narrowest and widest common widths, in light and dark; Work's tab strip
 * scrolls sideways without scrolling the page. Screenshots go to
 * CQ_E2E_SCREENSHOT_DIR when set, else the test's own output folder.
 */

const WIDTHS = [360, 390, 430] as const;
const THEMES = ["light", "dark"] as const;

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`Work tab and You sheet at ${String(width)} px, ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((choice) => {
        window.localStorage.setItem("cq.theme", choice);
      }, theme);
      await page.goto("/daily");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const nav = page.getByRole("navigation", { name: "Primary" });
      const work = nav.getByRole("link", { name: /^Work/ });
      // The Q Daily is one of Work's tabs, so the Work tab reads as current.
      await expect(work).toHaveAttribute("aria-current", "page");
      const tab = await work.boundingBox();
      expect(tab?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(tab?.height ?? 0).toBeGreaterThanOrEqual(44);

      const strip = page.getByRole("navigation", { name: "Work" });
      for (const name of ["Tasks", "Documents", "The Q Daily"]) {
        await expect(
          strip.getByRole("link", { name: new RegExp(name) }),
        ).toBeAttached();
      }
      await expect(
        strip.getByRole("link", { name: "The Q Daily" }),
      ).toHaveAttribute("aria-current", "page");

      const you = page.getByRole("banner").getByRole("button", { name: "You" });
      await you.tap();
      const sheet = page.getByRole("navigation", { name: "Your sections" });
      await expect(sheet).toBeVisible();
      for (const name of ["Profile", "Usage", "Settings"]) {
        const link = sheet.getByRole("link", { name: new RegExp(name) });
        await expect(link).toBeVisible();
        const box = await link.boundingBox();
        expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
      }
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
            ? testInfo.outputPath(`you-${String(width)}-${theme}.png`)
            : `${dir}/you-${String(width)}-${theme}.png`,
      });

      // A section opens and the sheet closes behind it.
      await sheet.getByRole("link", { name: "Settings" }).tap();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(sheet).toHaveCount(0);
    });
  }
}
