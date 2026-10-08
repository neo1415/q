/* global process, console, URL */
/**
 * Founder documents design-review screenshots
 * (docs/design/2026-10-08/founder-docs): every view at phone and desktop,
 * light and dark, from the static file.
 *
 *   node scripts/founder-docs-design-shots.mjs [chromium-executable]
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const dir = fileURLToPath(
  new URL("../docs/design/2026-10-08/founder-docs/", import.meta.url),
);
const page = pathToFileURL(`${dir}index.html`).href;
const out = `${dir}shots`;
await mkdir(out, { recursive: true });

const browser = await chromium.launch(
  process.argv[2] === undefined ? {} : { executablePath: process.argv[2] },
);
const sizes = { phone: [390, 844], desktop: [1280, 820] };
for (const view of ["requested", "dataroom", "access", "investor"]) {
  for (const device of ["phone", "desktop"]) {
    for (const theme of ["light", "dark"]) {
      const [width, height] = sizes[device];
      const tab = await browser.newPage({ viewport: { width, height } });
      await tab.goto(`${page}?view=${view}&theme=${theme}`);
      await tab.screenshot({
        path: `${out}/${view}-${device}-${theme}.png`,
        fullPage: view !== "access",
      });
      await tab.close();
    }
  }
}
await browser.close();
console.log(`wrote ${out}`);
