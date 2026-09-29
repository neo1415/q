import { Q_SLIDE_IMAGE_HOST } from "@capital-q/contracts";

import type { LaidOutDeck } from "./layout.js";

/**
 * The photographs a laid-out deck shows, fetched once for a file export
 * (founder direction 2026-09-29). Only from the stock library's image
 * host: a slide that names anywhere else is drawn without its photo. A
 * photo that cannot be fetched leaves its side of the slide empty rather
 * than failing the file.
 */
export type SlideImages = ReadonlyMap<string, Uint8Array>;

const MAX_BYTES = 4 * 1024 * 1024;

export async function fetchSlideImages(
  deck: LaidOutDeck,
  doFetch: typeof fetch = fetch,
): Promise<SlideImages> {
  const urls = new Set<string>();
  for (const slide of deck.slides) {
    for (const box of slide.boxes) {
      if (box.kind !== "IMAGE") continue;
      try {
        const url = new URL(box.url);
        if (url.protocol === "https:" && url.host === Q_SLIDE_IMAGE_HOST) {
          urls.add(box.url);
        }
      } catch {
        // Not a URL: drawn without a photo.
      }
    }
  }
  const found = new Map<string, Uint8Array>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = await doFetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES) {
          found.set(url, bytes);
        }
      } catch {
        // Unreachable: the slide keeps its words.
      }
    }),
  );
  return found;
}

/** JPEG or PNG, by their first bytes. */
export function imageKind(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  return null;
}
