import { QDailyImageSchema, type QDailyImage } from "@capital-q/contracts";
import { z } from "zod";

import type { DailyPhotoPort } from "../ports.js";

/**
 * Pexels photographs for The Q Daily (DAILY spec §2): free with credit to
 * the photographer and a link to Pexels, both printed under every photo.
 * Only public topic words leave Capital Q. Undefined without a key.
 */
const PEXELS_SEARCH = "https://api.pexels.com/v1/search";

const ResponseSchema = z.object({
  photos: z
    .array(
      z.object({
        url: z.string().nullish(),
        alt: z.string().nullish(),
        photographer: z.string().nullish(),
        src: z.object({ large: z.string() }),
      }),
    )
    .default([]),
});

export function createPexelsDailyPhotos(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): DailyPhotoPort | undefined {
  if (
    apiKey === undefined ||
    apiKey.length < 20 ||
    apiKey.startsWith("disabled")
  ) {
    return undefined;
  }
  return {
    search: async (query, signal) => {
      const url = new URL(PEXELS_SEARCH);
      url.searchParams.set("query", query.slice(0, 120));
      url.searchParams.set("orientation", "landscape");
      url.searchParams.set("per_page", "5");
      const timeout = AbortSignal.timeout(6_000);
      try {
        const response = await fetchImpl(url, {
          headers: { Authorization: apiKey },
          signal:
            signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
        if (!response.ok) return [];
        const parsed = ResponseSchema.safeParse(await response.json());
        if (!parsed.success) return [];
        const images: QDailyImage[] = [];
        for (const photo of parsed.data.photos) {
          const image = QDailyImageSchema.safeParse({
            url: photo.src.large,
            alt: ((photo.alt ?? "").trim() || query).slice(0, 200),
            credit:
              `Photo by ${photo.photographer ?? "a Pexels photographer"} on Pexels`.slice(
                0,
                160,
              ),
            creditUrl:
              typeof photo.url === "string" && photo.url.startsWith("https://")
                ? photo.url
                : "https://www.pexels.com",
            kind: "STOCK",
            linkUrl: null,
          });
          if (image.success) images.push(image.data);
        }
        return images;
      } catch {
        return [];
      }
    },
  };
}
