// Screenshots of the built Work page from its fixture route (/dev/workforce),
// served by `next start` with CQ_DEV_PREVIEW=1 on BASE (default :3123).
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
  // The dev route maps needs/progress/done to the one Work view.
  for (const view of ["needs", "team"]) {
    const page = await browser.newPage({ viewport });
    const response = await page.goto(`${base}/dev/workforce?view=${view}`, {
      // The shell keeps a connection open (notices), so never "networkidle".
      waitUntil: "load",
    });
    await page.waitForTimeout(800);
    const skip = page.getByText("Tap to skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(1_200);
    console.log(device, view, response?.status());
    await page.screenshot({
      path: join(out, `built-${view}-${device}.png`),
      fullPage: true,
    });
    await page.close();
  }
}
await browser.close();
