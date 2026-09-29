import type { QArtifactContent, QSlideImage } from "@capital-q/contracts";

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

export async function illustrateDeck(
  content: QArtifactContent,
  photos: StockPhotoPort,
  options: { readonly signal?: AbortSignal | undefined } = {},
): Promise<QArtifactContent> {
  const deck = content.deck;
  if (deck === undefined) return content;
  const about = queryWords(content.sections[0]?.body ?? "", 6);
  const used = new Set<string>();
  const pick = async (query: string): Promise<StockPhoto | null> => {
    if (query.trim().length === 0) return null;
    try {
      const found = await photos.search(query, options);
      return found.find((photo) => !used.has(photo.url)) ?? null;
    } catch {
      return null;
    }
  };

  const wanted = deck.slides
    .map((slide, index) => ({ slide, index }))
    .filter(
      ({ slide, index }) =>
        slide.image === undefined &&
        slide.visual === undefined &&
        slide.figures === undefined &&
        (index === 0 ? slide.layout === "TITLE" : slide.layout === "BULLETS"),
    )
    .slice(0, CONTENT_PHOTOS + 1);
  const chosen = new Map<number, StockPhoto>();
  for (const { slide, index } of wanted) {
    const query =
      index === 0
        ? about
        : `${queryWords(slide.title, 4)} ${queryWords(about, 3)}`.trim();
    const photo = await pick(query);
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
