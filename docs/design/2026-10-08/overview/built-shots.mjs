// Screenshots of the built company Overview from its fixture route
// (/dev/profile), served by `next start` with CQ_DEV_PREVIEW=1 on BASE.
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
const base = process.env.BASE ?? "http://127.0.0.1:3123";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  for (const side of ["investor", "owner"]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport, colorScheme: theme });
      const response = await page.goto(`${base}/dev/profile?side=${side}`, {
        waitUntil: "load",
      });
      await page.waitForTimeout(800);
      const skip = page.getByText("Tap to skip");
      if (await skip.isVisible().catch(() => false)) await skip.click();
      // Open the raise, as a reader would, to show the pitch as a source.
      await page
        .locator("details[data-overview-fold=company-raise]")
        .evaluate((el) => (el.open = true))
        .catch(() => {});
      await page.waitForTimeout(600);
      console.log(device, side, theme, response?.status());
      await page.screenshot({
        path: join(out, `built-${side}-${device}-${theme}.png`),
        fullPage: true,
      });
      await page.close();
    }
  }
}
await browser.close();
