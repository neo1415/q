// Screenshots of the arrival briefing mockup (docs/design/2026-10-08/briefing).
// Run: NODE_PATH=<repo>/node_modules/.pnpm/playwright@<v>/node_modules node shots.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ESM ignores NODE_PATH; resolve playwright through it explicitly.
const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", {
    paths: (process.env.NODE_PATH ?? "").split(":").filter(Boolean),
  }),
);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const devices = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
};
for (const screen of ["arrival", "edit", "quiet", "dock"]) {
  for (const [device, viewport] of Object.entries(devices)) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const url = `${pathToFileURL(join(here, "index.html")).href}?screen=${screen}&device=${device}&theme=${theme}`;
      await page.goto(url);
      await page.screenshot({
        path: join(out, `${screen}-${device}-${theme}.png`),
        fullPage: screen !== "dock",
      });
      await page.close();
    }
  }
}
await browser.close();
