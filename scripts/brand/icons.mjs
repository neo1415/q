#!/usr/bin/env node
/**
 * Capital Q's icons, from one mark (founder direction 2026-10-07: "the
 * favicon in the tab is still the blue stuff... the actual brand colour
 * -- gold and black").
 *
 * The mark is Q's ring and tail (ADR 0017; the same geometry as the
 * navigation icon and the splash): a gold ring and tail with a lit
 * champagne core, on a near-black tile. The tile is the icon's own
 * background, so the favicon reads gold on black whatever the OS theme.
 *
 * Colours are read from the black-and-gold brand preset
 * (apps/web/src/features/brand-theme/brand-presets.ts: INK, GOLD,
 * CHAMPAGNE), so the icons and the app's --cq-* brand tokens cannot drift.
 *
 * Writes, under apps/web:
 *   app/icon.svg                    the tab icon (vector, every size)
 *   app/favicon.ico                 16, 32 and 48 px, for agents that ask for /favicon.ico
 *   public/icons/apple-touch-icon.png   180 px, full bleed (iOS rounds it)
 *   public/icons/icon-192.png, icon-512.png   rounded tile ("any")
 *   public/icons/icon-maskable-512.png        full bleed, mark in the safe zone
 *
 * Run: node scripts/brand/icons.mjs   (uses the workspace's sharp)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");

// sharp is a dependency of @capital-q/public-identity; resolve it there
// rather than adding a root dependency for a build-time script.
const require = createRequire(
  join(ROOT, "packages", "public-identity", "package.json"),
);
const sharp = require("sharp");

const presets = readFileSync(
  join(WEB, "src", "features", "brand-theme", "brand-presets.ts"),
  "utf8",
);
function presetHex(name) {
  const match = new RegExp(`const ${name} = "(#[0-9a-fA-F]{6})"`).exec(presets);
  if (match === null) throw new Error(`brand-presets.ts has no ${name}`);
  return match[1].toLowerCase();
}
const INK = presetHex("INK");
const GOLD = presetHex("GOLD");
const CHAMPAGNE = presetHex("CHAMPAGNE");

/**
 * The mark on a 64-unit square. `bleed` fills the square (apple, maskable);
 * otherwise a rounded tile. `scale` shrinks the mark about the centre
 * (maskable icons keep it inside the 80% safe circle).
 */
function markSvg({ bleed = false, scale = 1 } = {}) {
  const tile = bleed
    ? `<rect width="64" height="64" fill="${INK}"/>`
    : `<rect width="64" height="64" rx="14" fill="${INK}"/>`;
  const t = (32 * (1 - scale)).toFixed(3);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
    tile,
    `<g transform="translate(${t} ${t}) scale(${String(scale)})">`,
    `<circle cx="29.5" cy="29.5" r="15" fill="none" stroke="${GOLD}" stroke-width="6.5"/>`,
    `<line x1="40.5" y1="40.5" x2="48.5" y2="48.5" stroke="${GOLD}" stroke-width="7" stroke-linecap="round"/>`,
    `<circle cx="29.5" cy="29.5" r="3.6" fill="${CHAMPAGNE}"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: Math.max(72, (size / 64) * 72) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An .ico holding PNG images (Vista+ and every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const tile = markSvg();
const bleed = markSvg({ bleed: true, scale: 0.92 });
const maskable = markSvg({ bleed: true, scale: 0.7 });

const out = {
  "app/icon.svg": Buffer.from(`${tile}\n`),
  "app/favicon.ico": ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(tile, size) })),
    ),
  ),
  "public/icons/apple-touch-icon.png": await png(bleed, 180),
  "public/icons/icon-192.png": await png(tile, 192),
  "public/icons/icon-512.png": await png(tile, 512),
  "public/icons/icon-maskable-512.png": await png(maskable, 512),
};
for (const [path, data] of Object.entries(out)) {
  writeFileSync(join(WEB, path), data);
  console.log(`wrote apps/web/${path} (${String(data.length)} bytes)`);
}
console.log(`ink ${INK} · gold ${GOLD} · core ${CHAMPAGNE}`);
