import type {
  PublicImageHit,
  PublicImageSearchProvider,
} from "../application/public-pictures.js";
import { ResearchProviderFailure } from "../ports.js";

/**
 * Google Images results behind the PublicImageSearchProvider port, from the
 * same SERP key the web search uses: Serper.dev's images endpoint, or
 * SerpApi's google_images engine. The key travels only to the vendor. A
 * hit keeps only the image, the page it is on and that page's title.
 */

export type ImageSearchOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  /** Test seam: a scripted fetch instead of the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_HITS = 10;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function classify(status: number): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

async function fetchJson(
  providerCode: "serper" | "serpapi",
  doFetch: typeof globalThis.fetch,
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal !== undefined) signals.push(signal);
  let response: Response;
  try {
    response = await doFetch(url, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  } catch (error: unknown) {
    throw new ResearchProviderFailure({
      providerCode,
      failureClass:
        error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "UNAVAILABLE",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ResearchProviderFailure({
      providerCode,
      failureClass: classify(response.status),
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error: unknown) {
    throw new ResearchProviderFailure({
      providerCode,
      failureClass: "UNAVAILABLE",
      status: response.status,
      cause: error,
    });
  }
}

const listOf = (
  body: unknown,
  key: string,
): readonly Record<string, unknown>[] => {
  if (body === null || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>)[key];
  return Array.isArray(list)
    ? list.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
};

export function createSerperImageSearch(
  options: ImageSearchOptions,
): PublicImageSearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    code: "serper",
    searchImages: async (query, context) => {
      const body = await fetchJson(
        "serper",
        doFetch,
        "https://google.serper.dev/images",
        {
          method: "POST",
          headers: {
            "X-API-KEY": options.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query, num: MAX_HITS }),
        },
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        context.signal,
      );
      const hits: PublicImageHit[] = [];
      for (const item of listOf(body, "images").slice(0, MAX_HITS)) {
        const imageUrl = text(item["imageUrl"]);
        const pageUrl = text(item["link"]);
        if (imageUrl === null || pageUrl === null) continue;
        hits.push({
          imageUrl,
          thumbnailUrl: text(item["thumbnailUrl"]),
          pageUrl,
          title: text(item["title"]),
        });
      }
      return hits;
    },
  };
}

export function createSerpApiImageSearch(
  options: ImageSearchOptions,
): PublicImageSearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    code: "serpapi",
    searchImages: async (query, context) => {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_images");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", options.apiKey);
      const body = await fetchJson(
        "serpapi",
        doFetch,
        url,
        {},
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        context.signal,
      );
      const hits: PublicImageHit[] = [];
      for (const item of listOf(body, "images_results").slice(0, MAX_HITS)) {
        const imageUrl = text(item["original"]);
        const pageUrl = text(item["link"]);
        if (imageUrl === null || pageUrl === null) continue;
        hits.push({
          imageUrl,
          thumbnailUrl: text(item["thumbnail"]),
          pageUrl,
          title: text(item["title"]),
        });
      }
      return hits;
    },
  };
}

/**
 * One SERP key whose vendor is not known from its name (as
 * serp-detect.ts): Serper.dev first, SerpApi on an authentication
 * failure, and whichever answered is kept.
 */
export function createDetectingImageSearch(
  options: ImageSearchOptions,
): PublicImageSearchProvider {
  const candidates = [
    createSerperImageSearch(options),
    createSerpApiImageSearch(options),
  ];
  let active = 0;
  let confirmed = false;
  return {
    get code() {
      return candidates[active]?.code ?? "serper";
    },
    searchImages: async (query, context) => {
      for (;;) {
        const provider = candidates[active];
        if (provider === undefined) throw new Error("no image search");
        try {
          const hits = await provider.searchImages(query, context);
          confirmed = true;
          return hits;
        } catch (error: unknown) {
          if (
            confirmed ||
            !(error instanceof ResearchProviderFailure) ||
            error.failureClass !== "AUTHENTICATION" ||
            active + 1 >= candidates.length
          ) {
            throw error;
          }
          active += 1;
        }
      }
    },
  };
}

/**
 * Several image indexes asked at once (Brave beside the SERP key), their
 * hits interleaved by rank, one per image. One index failing costs only
 * its own hits; all failing is the last failure.
 */
export function createMergedImageSearch(
  providers: readonly PublicImageSearchProvider[],
): PublicImageSearchProvider {
  return {
    code: providers.map((provider) => provider.code).join("+"),
    searchImages: async (query, context) => {
      const settled = await Promise.allSettled(
        providers.map((provider) => provider.searchImages(query, context)),
      );
      const lists: (readonly PublicImageHit[])[] = [];
      let failure: unknown = null;
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") lists.push(outcome.value);
        else failure = outcome.reason;
      }
      if (lists.length === 0 && failure !== null) {
        throw failure instanceof Error
          ? failure
          : new Error("every image search failed", { cause: failure });
      }
      const seen = new Set<string>();
      const merged: PublicImageHit[] = [];
      const longest = Math.max(0, ...lists.map((list) => list.length));
      for (let rank = 0; rank < longest; rank += 1) {
        for (const list of lists) {
          const hit = list[rank];
          if (hit === undefined || seen.has(hit.imageUrl)) continue;
          seen.add(hit.imageUrl);
          merged.push(hit);
        }
      }
      return merged;
    },
  };
}
