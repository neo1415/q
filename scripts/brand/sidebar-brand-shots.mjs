#!/usr/bin/env node
/* global process, console, sessionStorage, performance, Buffer */
/**
 * Screenshots for the sidebar-groups and brand-assets review (2026-10-07):
 * the sidebar's groups closed and open (desktop and phone's More sheet,
 * dark and light), the favicon at 16, 32 and 180 px, and the splash.
 *
 * Needs a production build served with the dev harnesses on:
 *   CQ_DEV_PREVIEW=1 next start --port 3110   (in apps/web)
 *   CQ_E2E_CHROMIUM=/path/to/chrome node scripts/brand/sidebar-brand-shots.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.CQ_SHOTS_BASE ?? "http://127.0.0.1:3110";
const OUT = join(ROOT, "docs", "design", "2026-10-07", "sidebar-brand");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CQ_E2E_CHROMIUM,
});
const PAGE = `${BASE}/dev/brand-preview?preset=black_gold&view=dock`;
let count = 0;
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  count += 1;
}

for (const scheme of ["dark", "light"]) {
  // Desktop sidebar: closed by default, then both groups opened.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    await context.addInitScript(() => {
      sessionStorage.setItem("cq.splash.seen", "1");
    });
    const page = await context.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    const sidebar = page.locator("[data-sidebar]");
    await sidebar.waitFor();
    await shot(page, `desktop-${scheme}-closed`);
    for (const name of ["Workspace", "You"]) {
      await sidebar.locator(`[data-nav-group-toggle="${name}"]`).click();
    }
    await page.waitForTimeout(300);
    await shot(page, `desktop-${scheme}-open`);
    // The folded rail keeps the same groups.
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.waitForTimeout(300);
    await shot(page, `desktop-${scheme}-rail-open`);
    await context.close();
  }
  // Phone: the More sheet holds the same groups.
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
    await context.addInitScript(() => {
      sessionStorage.setItem("cq.splash.seen", "1");
    });
    const page = await context.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    await page.locator("[data-nav-more]").click();
    await page.waitForTimeout(500);
    await shot(page, `phone-${scheme}-closed`);
    for (const name of ["Workspace", "You"]) {
      await page.locator(`[data-nav-group-toggle="${name}"]`).last().click();
    }
    await page.waitForTimeout(300);
    await shot(page, `phone-${scheme}-open`);
    await context.close();
  }
  // The splash on a cold session. A headless run hydrates later than a
  // phone on a good line, and the splash rightly steps aside when too
  // little of its time is left (P9); for the picture only, the page's
  // clock is slowed so it plays as it would on a quick load.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    await context.addInitScript(() => {
      const now = performance.now.bind(performance);
      performance.now = () => now() * 0.1;
    });
    const page = await context.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    await page.locator(".cq-splash[data-live]").waitFor();
    await page.waitForTimeout(600);
    await shot(page, `splash-${scheme}-forming`);
    await page.waitForTimeout(250);
    await shot(page, `splash-${scheme}`);
    await context.close();
  }
}

// The favicon as a tab shows it, on light and dark backgrounds, at 16,
// 32 and 180 px (the apple-touch icon).
{
  const svg = readFileSync(
    join(ROOT, "apps", "web", "app", "icon.svg"),
    "utf8",
  );
  const apple = readFileSync(
    join(ROOT, "apps", "web", "public", "icons", "apple-touch-icon.png"),
  ).toString("base64");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const context = await browser.newContext({
    viewport: { width: 520, height: 300 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><body style="margin:0;font:12px system-ui">
    ${["#ffffff", "#202124"]
      .map(
        (
          bg,
        ) => `<div style="display:flex;gap:24px;align-items:center;padding:20px;background:${bg};color:${bg === "#ffffff" ? "#202124" : "#e8eaed"}">
        <figure style="margin:0"><img src="${src}" width="16" height="16"><figcaption>16</figcaption></figure>
        <figure style="margin:0"><img src="${src}" width="32" height="32"><figcaption>32</figcaption></figure>
        <figure style="margin:0"><img src="data:image/png;base64,${apple}" width="90" height="90" style="border-radius:20px"><figcaption>180 (apple, half size)</figcaption></figure>
      </div>`,
      )
      .join("")}
  </body>`);
  await shot(page, "favicon-16-32-180");
  // Real pixels, one per size, at 1:1.
  for (const size of [16, 32, 180]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0"><img src="${size === 180 ? `data:image/png;base64,${apple}` : src}" width="${String(size)}" height="${String(size)}" style="display:block"></body>`,
    );
    await shot(page, `favicon-${String(size)}`);
  }
  await context.close();
}

await browser.close();
console.log(`${String(count)} screenshots in ${OUT}`);
