// Screenshots of the built arrival briefing on the dev harness
// (/dev/briefing, fictional data). Start the built web app with
// CQ_DEV_PREVIEW=1 on PORT (default 3111), then:
// NODE_PATH=<repo>/node_modules/.pnpm/playwright@<v>/node_modules node built-shots.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", {
    paths: (process.env.NODE_PATH ?? "").split(":").filter(Boolean),
  }),
);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.PORT ?? "3111"}`;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const devices = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
};
for (const [device, viewport] of Object.entries(devices)) {
  for (const theme of ["light", "dark"]) {
    for (const [name, query] of [
      ["arrival", ""],
      ["quiet", "?state=quiet"],
      ["dock", "?variant=dock"],
    ]) {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.goto(`${base}/dev/briefing${query}`);
      // The first-visit splash, skipped as a person would.
      await page
        .getByText("Tap to skip")
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      await page.locator("[data-arrival]").waitFor();
      await page.waitForTimeout(800);
      await page.screenshot({
        path: join(out, `built-${name}-${device}-${theme}.png`),
        fullPage: true,
      });
      if (name === "arrival") {
        await page
          .locator("[data-harness-say]")
          .fill("change the second sentence to Thursday at 3pm works best");
        await page.locator("[data-harness-say-send]").click();
        await page.locator("[data-arrival-confirm]").waitFor();
        await page.screenshot({
          path: join(out, `built-edit-${device}-${theme}.png`),
          fullPage: true,
        });
      }
      await context.close();
    }
  }
}
await browser.close();
