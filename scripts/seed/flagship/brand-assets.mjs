#!/usr/bin/env node
/**
 * Renders each flagship company's profile logo (512x512) and cover
 * (1600x600) locally with Playwright: brand.json colours plus the official
 * logo file downloaded from the company's own site (source URL recorded in
 * seed-state.json). No stock imagery, no network during rendering.
 *
 *   node scripts/seed/flagship/brand-assets.mjs <slug> <logo-file> <out-dir>
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
// Worktrees have no node_modules: fall back to the main checkout's copy.
const { chromium } = await import("playwright").catch(() =>
  import(
    process.env.CQ_PLAYWRIGHT ??
      "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs"
  ),
);

const [slug, logoFile, out] = process.argv.slice(2);
const mime = { ".png": "image/png", ".svg": "image/svg+xml" }[extname(logoFile)];
const src = `data:${mime};base64,${readFileSync(logoFile).toString("base64")}`;

// Per-brand layout. Colours come from docs/flagship/<slug>/brand.json.
const B = {
  kuuza: {
    bg: "#131313", accent: "#E9273B", ink: "#EFF6FC",
    // The square logo is the lockup's mark only (left 22% of the lockup).
    mark: `<div style="width:200px;height:180px;overflow:hidden;background:url(${src}) no-repeat;background-size:1393px 383px;background-position:-100px -102px;transform:scale(1.6)"></div>`,
    tagline: "AI simulator and coach for sales, service and human communication",
  },
  songscribe: {
    bg: "#0A0A0A", accent: "#E63946", ink: "#F5F5F5",
    mark: `<div style="width:62px;height:146px;overflow:hidden;background:url(${src}) no-repeat;background-size:588px 146px;background-position:0 0;transform:scale(2.4)"></div>`,
    tagline: "Your story, turned into a song",
  },
  "zino-aviation": {
    bg: "#141414", accent: "#B59B48", ink: "#F6F4EF",
    // Square logo: the four-stripe mark at the right of the official wordmark.
    mark: `<div style="width:196px;height:138px;overflow:hidden;background:url(${src}) no-repeat;background-size:904px 138px;background-position:-708px 0;transform:scale(1.7)"></div>`,
    tagline: "Pilot training, simulator and private aviation, Lagos",
  },
  "capital-q": {
    bg: "#16140F", accent: "#C9A227", ink: "#F3EEE2",
    mark: `<img src="${src}" style="width:300px">`,
    tagline: "Investment intelligence for private capital",
  },
}[slug];

const logoHtml = `<html><body style="margin:0;width:512px;height:512px;background:${B.bg};display:flex;align-items:center;justify-content:center;overflow:hidden">${B.mark}</body></html>`;
const coverHtml = `<html><body style="margin:0;width:1600px;height:600px;background:${B.bg};position:relative;overflow:hidden;font-family:Georgia,serif">
<div style="position:absolute;left:0;top:0;bottom:0;width:14px;background:${B.accent}"></div>
<div style="position:absolute;right:-180px;top:-180px;width:640px;height:640px;border-radius:50%;border:2px solid ${B.accent};opacity:.35"></div>
<div style="position:absolute;right:-60px;top:-60px;width:400px;height:400px;border-radius:50%;border:2px solid ${B.accent};opacity:.2"></div>
<div style="position:absolute;left:120px;top:190px"><img src="${src}" style="height:${slug === "kuuza" ? 160 : 110}px;${slug === "kuuza" ? "margin-left:-60px" : ""}"></div>
<div style="position:absolute;left:120px;top:380px;color:${B.ink};font-size:34px;letter-spacing:.2px;opacity:.85">${B.tagline}</div>
</body></html>`;

mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium" });
for (const [name, html, w, h] of [["logo", logoHtml, 512, 512], ["cover", coverHtml, 1600, 600]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.waitForTimeout(300);
  const path = join(out, `${slug}-${name}.png`);
  await p.screenshot({ path });
  console.log(path);
}
await b.close();
