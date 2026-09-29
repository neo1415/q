import { QSlideImageSchema } from "@capital-q/contracts";
import type { StockPhoto, StockPhotoPort } from "@capital-q/q-specialists";
import { z } from "zod";

/**
 * Pexels behind the deck-photo port (founder direction 2026-09-29).
 *
 * Pexels is free with attribution, so the credit line travels with every
 * photo. Only the search words leave Capital Q -- words taken from the
 * deck's own title and description -- never a document, a figure or a
 * person. A failed or slow search means a deck without a photo, never a
 * failed deck.
 */
const PEXELS_SEARCH = "https://api.pexels.com/v1/search";
const TIMEOUT_MS = 6_000;

const PexelsResponseSchema = z.object({
  photos: z
    .array(
      z.object({
        alt: z.string().nullish(),
        photographer: z.string().nullish(),
        src: z.object({ large: z.string() }),
      }),
    )
    .default([]),
});

/** Undefined when no key is configured: decks are made without photos. */
export function createPexelsPhotos(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): StockPhotoPort | undefined {
  // A disabled placeholder (tests, local stacks) is not a key.
  if (
    apiKey === undefined ||
    apiKey.length < 20 ||
    apiKey.startsWith("disabled")
  ) {
    return undefined;
  }
  return {
    search: async (query, options) => {
      const url = new URL(PEXELS_SEARCH);
      url.searchParams.set("query", query.slice(0, 120));
      url.searchParams.set("orientation", "landscape");
      url.searchParams.set("per_page", "5");
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const response = await fetchImpl(url, {
        headers: { Authorization: apiKey },
        signal:
          options.signal === undefined
            ? timeout
            : AbortSignal.any([options.signal, timeout]),
      });
      if (!response.ok) return [];
      const parsed = PexelsResponseSchema.safeParse(await response.json());
      if (!parsed.success) return [];
      const photos: StockPhoto[] = [];
      for (const photo of parsed.data.photos) {
        const image = QSlideImageSchema.safeParse({
          url: photo.src.large,
          alt: ((photo.alt ?? "").trim() || query).slice(0, 200),
          credit:
            `Photo by ${photo.photographer ?? "a Pexels photographer"} on Pexels`.slice(
              0,
              120,
            ),
        });
        if (image.success) photos.push(image.data);
      }
      return photos;
    },
  };
}
