/**
 * GateQ F1-F4 design-review screenshots: every state of the /dev/gateq-v2
 * gallery at 390 and 1440, light and dark (design 2026-10-06/a/gateq.html).
 *
 *   CQ_DEV_PREVIEW=1 next start --port 3917   # a production build
 *   node scripts/gateq-screenshots.mjs http://127.0.0.1:3917 <out-dir>
 *
 * Reads nothing and writes nothing but the images: the gallery is fixtures.
 */
import { mkdir } from "node:fs/promises";

import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3917";
const out = process.argv[3] ?? "./gateq-screenshots";

const STATES = ["full", "loading", "empty", "error", "limited"];
const shots = [
  ...STATES.map((state) => [`form-${state}`, `view=form&state=${state}`]),
  ...["round", "share", "note", "check", "sent"].map((step) => [
    `form-step-${step}`,
    `view=form&step=${step}`,
  ]),
  ...STATES.map((state) => [`founder-${state}`, `view=founder&state=${state}`]),
  ...STATES.map((state) => [`claim-${state}`, `view=claim&state=${state}`]),
  ["claim-verify-sheet", "view=claim&sheet=claim"],
  ...STATES.map((state) => [`inbox-${state}`, `view=inbox&state=${state}`]),
  ["inbox-bulk-select", "view=inbox&bulk=1"],
  [
    "inbox-pass-draft",
    "view=inbox&sheet=pass&sel=00000000-0000-4000-8000-000000000006",
  ],
  ["inbox-download-pack", "view=inbox&sheet=pack"],
  ["inbox-solo-investor", "view=inbox&solo=1"],
  ["inbox-detail-phone", "view=inbox-detail"],
  ["inbox-detail-member-role", "view=inbox-detail&state=limited"],
  ["inbox-view-fits", "view=inbox&chip=FITS"],
  ...STATES.map((state) => [`find-${state}`, `view=find&state=${state}`]),
  ...STATES.map((state) => [`gate-${state}`, `view=gate&state=${state}`]),
];

await mkdir(out, { recursive: true });
// A machine whose browsers predate this Playwright names one with CQ_CHROMIUM.
const browser = await chromium.launch(
  process.env.CQ_CHROMIUM === undefined
    ? {}
    : { executablePath: process.env.CQ_CHROMIUM },
);
let count = 0;
for (const [width, height, device] of [
  [390, 844, "phone"],
  [1440, 900, "desktop"],
]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const [name, query] of shots) {
      const response = await page.goto(`${base}/dev/gateq-v2?${query}`, {
        waitUntil: "load",
      });
      if (response === null || !response.ok()) {
        throw new Error(`${name}: HTTP ${response?.status() ?? "none"}`);
      }
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${name}-${device}-${theme}.png` });
      count += 1;
    }
    await context.close();
  }
}
await browser.close();
console.log(`${count} screenshots in ${out}`);
