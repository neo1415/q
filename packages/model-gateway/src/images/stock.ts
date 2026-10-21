import {
  QPictureBlockSchema,
  QSlideImageSchema,
  type QResultBlock,
  type QSlideImage,
} from "@capital-q/contracts";
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
        photographer_url: z.string().nullish(),
        /** The photo's own page at Pexels. */
        url: z.string().nullish(),
        src: z.object({ large: z.string() }),
      }),
    )
    .default([]),
});
type PexelsPhoto = z.infer<typeof PexelsResponseSchema>["photos"][number];

/** A disabled placeholder (tests, local stacks) is not a key. */
export function isUsableStockKey(apiKey: string | undefined): apiKey is string {
  return (
    apiKey !== undefined &&
    apiKey.length >= 20 &&
    !apiKey.startsWith("disabled")
  );
}

/** One bounded search; any failure is no photos, never a throw. */
async function searchPexels(
  apiKey: string,
  fetchImpl: typeof fetch,
  query: string,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly perPage: number;
  },
): Promise<readonly PexelsPhoto[]> {
  const url = new URL(PEXELS_SEARCH);
  url.searchParams.set("query", query.slice(0, 120));
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", String(options.perPage));
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
  return parsed.success ? parsed.data.photos : [];
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
      const photos: StockPhoto[] = [];
      for (const photo of await searchPexels(apiKey, fetchImpl, query, {
        signal: options.signal,
        perPage: 5,
      })) {
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

/**
 * L-13: a picture for Q's answer, as the public PICTURE block, so what
 * the contract refuses (another host, no credit) never leaves here. The
 * caller decides the search words; this adapter only searches.
 */
export type StockPicture = Extract<QResultBlock, { readonly kind: "PICTURE" }>;

export type StockPictureProvider = {
  readonly code: string;
  /** Pictures for a search, best first; empty when none or on failure. */
  readonly search: (
    query: string,
    options: { readonly signal?: AbortSignal | undefined },
  ) => Promise<readonly StockPicture[]>;
};

/** Undefined when no usable key is configured: answers go without pictures. */
export function createPexelsPictureProvider(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): StockPictureProvider | undefined {
  if (!isUsableStockKey(apiKey)) return undefined;
  return {
    code: "pexels",
    search: async (query, options) => {
      const pictures: StockPicture[] = [];
      for (const photo of await searchPexels(apiKey, fetchImpl, query, {
        signal: options.signal,
        perPage: 3,
      })) {
        const picture = QPictureBlockSchema.safeParse({
          kind: "PICTURE",
          url: photo.src.large,
          alt: ((photo.alt ?? "").trim() || query).slice(0, 200),
          credit: {
            name: (
              (photo.photographer ?? "").trim() || "A Pexels photographer"
            ).slice(0, 120),
            // A credit link that is not https loses the link, not the picture.
            url: photo.photographer_url?.startsWith("https://")
              ? photo.photographer_url
              : null,
          },
          source: "PEXELS",
          pageUrl: photo.url,
        });
        if (picture.success) pictures.push(picture.data);
      }
      return pictures;
    },
  };
}
