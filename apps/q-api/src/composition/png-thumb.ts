import { inflateSync } from "node:zlib";

/**
 * 2026-10-20 (meetings speed): a frame's look, small enough to compare.
 *
 * Recall streams call video as PNG frames. Whether a shared screen or a
 * camera "changed" used to be judged on the PNG's bytes, and any moving
 * cursor or clock re-encodes the whole image, so Q looked (a vision model
 * call) on a fixed timer in practice. This decodes the frame to a 32 x 18
 * grey thumbnail, so a change is a change people would see. Frames are
 * decoded in memory only, never stored or logged.
 *
 * Supports what Recall sends (8-bit, non-interlaced grey, RGB, palette,
 * grey+alpha, RGBA). Anything else is null: the caller falls back to its
 * byte check.
 */

export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 18;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Larger than a 1080p RGBA frame: anything bigger is not a call frame. */
const MAX_PIXELS = 1920 * 1088;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The frame as a 32 x 18 grey thumbnail (0..255 per cell); null if unreadable. */
export function pngThumb(png: Uint8Array): Uint8Array | null {
  try {
    if (png.length < 33 || SIGNATURE.some((byte, i) => png[i] !== byte)) {
      return null;
    }
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let width = 0;
    let height = 0;
    let colourType = -1;
    let palette: Uint8Array | null = null;
    const data: Uint8Array[] = [];
    for (let at = 8; at + 8 <= png.length;) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(
        png[at + 4] ?? 0,
        png[at + 5] ?? 0,
        png[at + 6] ?? 0,
        png[at + 7] ?? 0,
      );
      const body = png.subarray(at + 8, at + 8 + length);
      if (type === "IHDR") {
        width = view.getUint32(at + 8);
        height = view.getUint32(at + 12);
        const depth = png[at + 16];
        colourType = png[at + 17] ?? -1;
        const interlace = png[at + 20];
        if (depth !== 8 || interlace !== 0) return null;
      } else if (type === "PLTE") {
        palette = body;
      } else if (type === "IDAT") {
        data.push(body);
      } else if (type === "IEND") {
        break;
      }
      at += 12 + length;
    }
    const channels = CHANNELS[colourType];
    if (
      channels === undefined ||
      width === 0 ||
      height === 0 ||
      width * height > MAX_PIXELS
    ) {
      return null;
    }
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * channels;
    if (raw.length < height * (stride + 1)) return null;
    const sums = new Float64Array(THUMB_WIDTH * THUMB_HEIGHT);
    const counts = new Uint32Array(THUMB_WIDTH * THUMB_HEIGHT);
    let previous = new Uint8Array(stride);
    let row = new Uint8Array(stride);
    for (let y = 0; y < height; y += 1) {
      const filter = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x += 1) {
        const value = line[x] ?? 0;
        const left = x >= channels ? (row[x - channels] ?? 0) : 0;
        const up = previous[x] ?? 0;
        const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
        row[x] =
          filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + ((left + up) >> 1)
                : filter === 4
                  ? value + paeth(left, up, upLeft)
                  : value;
      }
      const cellY = Math.min(
        THUMB_HEIGHT - 1,
        Math.floor((y * THUMB_HEIGHT) / height),
      );
      for (let x = 0; x < width; x += 1) {
        const at = x * channels;
        let grey: number;
        if (colourType === 3) {
          const index = (row[at] ?? 0) * 3;
          grey =
            palette === null
              ? (row[at] ?? 0)
              : ((palette[index] ?? 0) * 3 +
                  (palette[index + 1] ?? 0) * 6 +
                  (palette[index + 2] ?? 0)) /
                10;
        } else if (channels >= 3) {
          grey =
            ((row[at] ?? 0) * 3 + (row[at + 1] ?? 0) * 6 + (row[at + 2] ?? 0)) /
            10;
        } else {
          grey = row[at] ?? 0;
        }
        const cell =
          cellY * THUMB_WIDTH +
          Math.min(THUMB_WIDTH - 1, Math.floor((x * THUMB_WIDTH) / width));
        sums[cell] = (sums[cell] ?? 0) + grey;
        counts[cell] = (counts[cell] ?? 0) + 1;
      }
      [previous, row] = [row, previous];
    }
    const thumb = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
    for (let i = 0; i < thumb.length; i += 1) {
      const count = counts[i] ?? 0;
      thumb[i] = count === 0 ? 0 : Math.round((sums[i] ?? 0) / count);
    }
    return thumb;
  } catch {
    return null;
  }
}

/** A base64 PNG frame's thumbnail; null when unreadable. */
export function frameThumb(base64: string): Uint8Array | null {
  return pngThumb(Buffer.from(base64, "base64"));
}
