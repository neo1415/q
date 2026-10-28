import type { ChunkLocator, ChunkRole } from "../contracts/index.js";

/**
 * The passages a model reads when it reads a whole document (a founder's
 * deck at onboarding, the deck reader's twelve sections).
 *
 * Two rules, both about honesty of coverage:
 *
 *   1. No duplicates. A long section or slide is stored as a PARENT with
 *      LEAF children that cover the same text; reading both spends the
 *      budget twice on the same words. Leaves alone cover the document.
 *   2. The whole document, never "the first N". A deck's traction, numbers
 *      and ask sit at the end. When the text is longer than the budget,
 *      every page or slide gets a fair share (unused share is handed on),
 *      and when there are more places than the budget can give a useful
 *      share to, places are sampled at an even stride from first to last.
 *
 * Deterministic and pure: the same chunks and budget give the same reading.
 */

export type ReadableChunk = {
  readonly role: ChunkRole;
  readonly chunkIndex: number;
  readonly content: string;
  readonly locator: Pick<ChunkLocator, "slide" | "pageStart" | "sheet">;
};

export type ReadingSelection<T> = {
  /** In document order; a passage may be clipped to its place's share. */
  readonly passages: readonly T[];
  /** True when any text was left out or clipped to fit the budget. */
  readonly sampled: boolean;
  /** How many distinct pages/slides the document has, and how many are read. */
  readonly placesTotal: number;
  readonly placesRead: number;
};

/** Below this, a share of a page is too small to be worth reading. */
export const MIN_CHARACTERS_PER_PLACE = 600;

function placeOf(chunk: ReadableChunk): string {
  if (chunk.locator.slide !== undefined)
    return `s${String(chunk.locator.slide)}`;
  if (chunk.locator.pageStart !== undefined)
    return `p${String(chunk.locator.pageStart)}`;
  if (chunk.locator.sheet !== undefined) return `x${chunk.locator.sheet}`;
  return `c${String(chunk.chunkIndex)}`;
}

/** Cuts at a word boundary near the limit, never mid-word when avoidable. */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

export function selectReadingPassages<T extends ReadableChunk>(
  chunks: readonly T[],
  options: { readonly maxCharacters: number },
): ReadingSelection<T> {
  const budget = Math.max(0, Math.floor(options.maxCharacters));
  const leaves = chunks
    .filter((chunk) => chunk.role === "LEAF" && chunk.content.trim() !== "")
    .toSorted((a, b) => a.chunkIndex - b.chunkIndex);

  // Places in document order, each with its leaves.
  const places: { key: string; leaves: T[]; size: number }[] = [];
  const byKey = new Map<string, { key: string; leaves: T[]; size: number }>();
  for (const leaf of leaves) {
    const key = placeOf(leaf);
    let place = byKey.get(key);
    if (place === undefined) {
      place = { key, leaves: [], size: 0 };
      byKey.set(key, place);
      places.push(place);
    }
    place.leaves.push(leaf);
    place.size += leaf.content.length;
  }
  const total = places.reduce((n, p) => n + p.size, 0);
  if (total <= budget) {
    return {
      passages: leaves,
      sampled: false,
      placesTotal: places.length,
      placesRead: places.length,
    };
  }

  // Too many places for a useful share each: an even stride across the
  // whole document, always including the first and the last place.
  const capacity = Math.max(1, Math.floor(budget / MIN_CHARACTERS_PER_PLACE));
  let chosen = places;
  if (places.length > capacity) {
    const picks = new Set<number>();
    if (capacity === 1) picks.add(0);
    else {
      for (let i = 0; i < capacity; i += 1) {
        picks.add(Math.round((i * (places.length - 1)) / (capacity - 1)));
      }
    }
    chosen = places.filter((_, at) => picks.has(at));
  }

  // Water-filling: a place smaller than its share takes all of it and
  // hands the rest on to the places that need more.
  const shares = new Map<string, number>();
  let remaining = budget;
  let open = [...chosen];
  while (open.length > 0) {
    const share = Math.floor(remaining / open.length);
    const small = open.filter((p) => p.size <= share);
    if (small.length === 0) {
      for (const p of open) shares.set(p.key, share);
      break;
    }
    for (const p of small) {
      shares.set(p.key, p.size);
      remaining -= p.size;
    }
    open = open.filter((p) => p.size > share);
  }

  const passages: T[] = [];
  for (const place of chosen) {
    let left = shares.get(place.key) ?? 0;
    for (const leaf of place.leaves) {
      if (left <= 0) break;
      if (leaf.content.length <= left) {
        passages.push(leaf);
        left -= leaf.content.length;
      } else {
        const clipped = clipText(leaf.content, left);
        if (clipped.length > 0) passages.push({ ...leaf, content: clipped });
        left = 0;
      }
    }
  }
  return {
    passages,
    sampled: true,
    placesTotal: places.length,
    placesRead: chosen.length,
  };
}
