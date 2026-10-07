/* global process, console */
/**
 * Overdeliver design-review screenshots (docs/design/2026-10-07/overdeliver):
 * every screen at phone and desktop, light and dark, from the static file.
 *
 *   node scripts/overdeliver-design-shots.mjs [chromium-executable]
 *
 * Reads the design file only and writes only the images.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const dir = fileURLToPath(
  new URL("../docs/design/2026-10-07/overdeliver/", import.meta.url),
);
const page = pathToFileURL(`${dir}index.html`).href;
const out = `${dir}shots`;
await mkdir(out, { recursive: true });

const browser = await chromium.launch(
  process.argv[2] === undefined ? {} : { executablePath: process.argv[2] },
);
const sizes = { phone: [390, 844], desktop: [1280, 820] };
for (const screen of [
  "interview",
  "contradiction",
  "plan",
  "investor",
  "room",
]) {
  for (const device of ["phone", "desktop"]) {
    for (const theme of ["light", "dark"]) {
      const [width, height] = sizes[device];
      const tab = await browser.newPage({ viewport: { width, height } });
      await tab.goto(
        `${page}?screen=${screen}&device=${device}&theme=${theme}`,
      );
      await tab.screenshot({
        path: `${out}/${screen}-${device}-${theme}.png`,
        fullPage: true,
      });
      await tab.close();
    }
  }
}
await browser.close();
console.log(`wrote ${out}`);
