import type { QArtifactContent, QSlideImage } from "@capital-q/contracts";

import { slideTopic } from "./deck-writer.js";
import { SLIDE_TITLES } from "./pitch-deck.js";

/**
 * Photographs for a deck (founder direction 2026-09-29): free stock photos
 * that set the scene -- the market, the work, the place -- beside what the
 * slide says. A photo is decoration, never evidence: it carries no claim,
 * its credit travels with it, and a deck is complete without one.
 *
 * The search words come from the deck itself (the company's own
 * description and each slide's title), never from a model's imagination.
 */
export type StockPhoto = QSlideImage;

export type StockPhotoPort = {
  /** Landscape photos for a search, best first; empty when none. */
  readonly search: (
    query: string,
    options: { readonly signal?: AbortSignal | undefined },
  ) => Promise<readonly StockPhoto[]>;
};

/** How many slides get a photo, beyond the cover. */
const CONTENT_PHOTOS = 3;

function queryWords(text: string, limit: number): string {
  return text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, limit)
    .join(" ");
}

/**
 * What a photo for each slide topic shows (live 2026-10-07: the search is
 * the company's sector plus the slide's subject, so a fintech's market
 * slide gets a market, not the words of its longest sentence). The team
 * and product are the person's own pictures and are never searched for.
 */
const PHOTO_TOPICS: Readonly<Record<string, string>> = {
  cover: "modern office",
  [SLIDE_TITLES.DESCRIPTION]: "small business work",
  [SLIDE_TITLES.MARKET]: "market city street",
  [SLIDE_TITLES.BUSINESS_MODEL]: "business payment",
  [SLIDE_TITLES.CUSTOMERS]: "small business owner",
  [SLIDE_TITLES.TRACTION]: "growth teamwork",
  [SLIDE_TITLES.STRATEGY]: "city skyline future",
  [SLIDE_TITLES.CAPITAL_OBJECTIVE]: "handshake meeting",
};
const OWN_PICTURES: ReadonlySet<string> = new Set([
  SLIDE_TITLES.TEAM,
  SLIDE_TITLES.PRODUCT,
]);
/** Statement slides that set a scene take a photo before the others. */
const SCENE_FIRST: readonly string[] = [
  SLIDE_TITLES.DESCRIPTION,
  SLIDE_TITLES.MARKET,
  SLIDE_TITLES.STRATEGY,
  SLIDE_TITLES.CUSTOMERS,
  SLIDE_TITLES.BUSINESS_MODEL,
];

/** "digital_lending" → "digital lending": a taxonomy code as search words. */
function sectorWords(codes: readonly string[] | undefined): string {
  const code = codes?.find((value) => /^[a-z][a-z0-9_]*$/i.test(value.trim()));
  return code === undefined ? "" : code.trim().toLowerCase().replace(/_/g, " ");
}

export async function illustrateDeck(
  content: QArtifactContent,
  photos: StockPhotoPort,
  options: {
    readonly sectorCodes?: readonly string[] | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<QArtifactContent> {
  const deck = content.deck;
  if (deck === undefined) return content;
  const about = queryWords(content.sections[0]?.body ?? "", 6);
  const sector = sectorWords(options.sectorCodes);
  const used = new Set<string>();
  const pick = async (query: string): Promise<StockPhoto | null> => {
    if (query.trim().length === 0) return null;
    try {
      const found = await photos.search(query, { signal: options.signal });
      return found.find((photo) => !used.has(photo.url)) ?? null;
    } catch {
      return null;
    }
  };

  const candidates = deck.slides
    .map((slide, index) => ({
      slide,
      index,
      topic: slideTopic(content, index),
    }))
    .filter(
      ({ slide, index, topic }) =>
        slide.image === undefined &&
        // Q room W5: a marked space is the person's to fill.
        slide.placeholder === undefined &&
        slide.visual === undefined &&
        slide.figures === undefined &&
        slide.chart === undefined &&
        !OWN_PICTURES.has(topic) &&
        (index === 0
          ? slide.layout === "TITLE"
          : slide.layout === "BULLETS" || slide.layout === "STATEMENT"),
    );
  const rank = (topic: string): number => {
    const at = SCENE_FIRST.indexOf(topic);
    return at === -1 ? SCENE_FIRST.length : at;
  };
  const cover = candidates.filter(({ index }) => index === 0);
  const inside = candidates
    .filter(({ index }) => index > 0)
    .sort((a, b) => rank(a.topic) - rank(b.topic) || a.index - b.index)
    .slice(0, CONTENT_PHOTOS);
  const chosen = new Map<number, StockPhoto>();
  for (const { slide, index, topic } of [...cover, ...inside]) {
    const subject =
      PHOTO_TOPICS[topic] ?? queryWords(index === 0 ? about : slide.title, 4);
    const query =
      sector.length > 0
        ? `${sector} ${subject}`
        : index === 0
          ? about
          : `${queryWords(slide.title, 4)} ${queryWords(about, 3)}`.trim();
    // A query with nothing found falls back to the subject alone.
    const photo =
      (await pick(query)) ?? (sector.length > 0 ? await pick(subject) : null);
    if (photo !== null) {
      used.add(photo.url);
      chosen.set(index, photo);
    }
  }
  if (chosen.size === 0) return content;
  return {
    ...content,
    deck: {
      ...deck,
      slides: deck.slides.map((slide, index) => {
        const photo = chosen.get(index);
        return photo === undefined ? slide : { ...slide, image: photo };
      }),
    },
  };
}
