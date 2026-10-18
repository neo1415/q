import { QSlideImageSchema, type QSlideImage } from "@capital-q/contracts";
import { z } from "zod";

/**
 * Stock photographs for documents, behind an adapter (Q room W5, R8;
 * founder clarification 2026-10-06: Pexels via `PEXELS_API`, not
 * Unsplash).
 *
 * Pexels is free with attribution, so the credit line travels with every
 * photo (on the picture, and in the slide's notes). Only search words
 * leave Capital Q -- words from the document's own title and slide
 * headings -- never a document, a figure or a person. A failed or slow
 * search is "no photo", never a failed document, and it is not retried.
 */
export type StockPhoto = QSlideImage;

export type StockPhotoProvider = {
  readonly code: string;
  readonly search: (
    query: string,
    options: { readonly signal?: AbortSignal | undefined },
  ) => Promise<readonly StockPhoto[]>;
};

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

/** A disabled placeholder (tests, local stacks) is not a key. */
export function isUsableStockKey(apiKey: string | undefined): apiKey is string {
  return (
    apiKey !== undefined &&
    apiKey.length >= 20 &&
    !apiKey.startsWith("disabled")
  );
}

/** Undefined when no usable key is configured: documents go without photos. */
export function createPexelsStockPhotoProvider(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): StockPhotoProvider | undefined {
  if (!isUsableStockKey(apiKey)) return undefined;
  return {
    code: "pexels",
    search: async (query, options) => {
      const url = new URL(PEXELS_SEARCH);
      url.searchParams.set("query", query.slice(0, 120));
      url.searchParams.set("orientation", "landscape");
      url.searchParams.set("per_page", "5");
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: apiKey },
          signal:
            options.signal === undefined
              ? timeout
              : AbortSignal.any([options.signal, timeout]),
        });
      } catch {
        return [];
      }
      if (!response.ok) return [];
      const parsed = PexelsResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
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
