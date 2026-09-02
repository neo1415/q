/**
 * Generates the temporary Capital Q application icons deterministically,
 * with no image dependency: a restrained geometric "Q" (ring + tail) on the
 * accent, rendered with 4× supersampling and written as PNG via zlib.
 *
 *   node apps/web/scripts/generate-pwa-icons.mjs
 *
 * Replace the outputs with approved brand assets when they exist; the
 * manifest and layout reference the file names, not this script.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

// sRGB renderings of --cq-accent and --cq-text-inverse (light). Fixed brand
// asset values; the only place outside tokens where a raw colour is allowed.
const ACCENT = [0x26, 0x73, 0xdf];
const GLYPH = [0xff, 0xff, 0xff];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance helpers in unit space (0..1). */
function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function inGlyph(x, y, scale) {
  // Centre the glyph slightly up-left so the tail reads balanced.
  const gx = (x - 0.48) / scale;
  const gy = (y - 0.48) / scale;
  const r = Math.hypot(gx, gy);
  if (r >= 0.195 && r <= 0.305) {
    return true;
  }
  // Tail: a rounded segment from the ring toward the bottom-right corner.
  const ax = 0.17;
  const ay = 0.17;
  const bx = 0.31;
  const by = 0.31;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((gx - ax) * (bx - ax) + (gy - ay) * (by - ay)) /
        ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  const px = ax + t * (bx - ax);
  const py = ay + t * (by - ay);
  return Math.hypot(gx - px, gy - py) <= 0.058;
}

function render(size, { maskable }) {
  const samples = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const glyphScale = maskable ? 0.78 : 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const ux = (x + (sx + 0.5) / samples) / size;
          const uy = (y + (sy + 0.5) / samples) / size;
          const background = maskable || inRoundedSquare(ux, uy, 0.22);
          if (!background) {
            continue;
          }
          const colour = inGlyph(ux, uy, glyphScale) ? GLYPH : ACCENT;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }
      const n = samples * samples;
      const coverage = a / n;
      const i = (y * size + x) * 4;
      // Premultiplied average → straight alpha.
      const opaque = a > 0 ? (n * (a / n)) / 255 : 0;
      rgba[i] = opaque > 0 ? Math.round(r / opaque) : 0;
      rgba[i + 1] = opaque > 0 ? Math.round(g / opaque) : 0;
      rgba[i + 2] = opaque > 0 ? Math.round(b / opaque) : 0;
      rgba[i + 3] = Math.round(coverage);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
const outputs = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  // iOS applies its own mask, so the Apple icon is full-bleed.
  ["apple-touch-icon.png", 180, { maskable: true }],
];
for (const [name, size, options] of outputs) {
  writeFileSync(join(OUT_DIR, name), render(size, options));
  console.log(`wrote ${name}`);
}
