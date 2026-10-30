import {
  RESEARCH_BOUNDS,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
} from "../contracts.js";
import type {
  PublicImageHit,
  PublicImageSearchProvider,
} from "../application/public-pictures.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";
import { webText } from "./web-text.js";

/**
 * Brave Search (api.search.brave.com) behind the research ports (owner
 * 2026-10-23: "use them in parallel; Q has no excuse not to have excellent
 * internet searching"). Brave keeps its own index, not Google's, so beside
 * Tavily and the SERP key it finds what they miss. Web search, its news
 * vertical for a news turn (The Q Daily, "latest news on …"), and image
 * search for pictures. It does not read pages: a page read goes to the
 * next provider. The key travels only in the request header to Brave.
 */

export type BraveOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  /** Test seam: a scripted fetch instead of the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
};

const BASE = "https://api.search.brave.com/res/v1";
const DEFAULT_TIMEOUT_MS = 6_000;

function classify(status: number): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

function freshnessOf(
  freshness: PublicWebSearchRequest["freshness"],
): string | null {
  switch (freshness) {
    case "PAST_DAY":
      return "pd";
    case "PAST_WEEK":
      return "pw";
    case "PAST_MONTH":
      return "pm";
    case "PAST_YEAR":
      return "py";
    case "ANY":
      return null;
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** Brave marks the matched words with <strong>; a snippet is plain text. */
const plain = (value: string): string =>
  webText(value.replace(/<[^>]*>/gu, ""))
    .replace(/\s+/gu, " ")
    .trim();

const listOf = (
  body: unknown,
  path: readonly string[],
): readonly Record<string, unknown>[] => {
  let at: unknown = body;
  for (const key of path) {
    if (at === null || typeof at !== "object") return [];
    at = (at as Record<string, unknown>)[key];
  }
  return Array.isArray(at)
    ? at.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
};

export function createBraveClient(options: BraveOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (
    vertical: "web" | "news" | "images",
    params: Readonly<Record<string, string>>,
    context: ResearchExecutionContext,
  ): Promise<unknown> => {
    const url = new URL(`${BASE}/${vertical}/search`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (context.signal !== undefined) signals.push(context.signal);
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": options.apiKey,
        },
        signal: AbortSignal.any(signals),
      });
    } catch (error: unknown) {
      throw new ResearchProviderFailure({
        providerCode: "brave",
        failureClass:
          error instanceof Error && error.name === "TimeoutError"
            ? "TIMEOUT"
            : "UNAVAILABLE",
        cause: error,
      });
    }
    if (!response.ok) {
      throw new ResearchProviderFailure({
        providerCode: "brave",
        failureClass: classify(response.status),
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch (error: unknown) {
      throw new ResearchProviderFailure({
        providerCode: "brave",
        failureClass: "UNAVAILABLE",
        status: response.status,
        cause: error,
      });
    }
  };
}

export function createBraveResearchProvider(
  options: BraveOptions,
): PublicWebResearchProvider {
  const call = createBraveClient(options);
  return {
    code: "brave",
    search: async (request, context) => {
      const startedAt = Date.now();
      const sites = request.includeDomains
        .map((domain) => `site:${domain}`)
        .join(" OR ");
      const news = request.topic === "NEWS";
      const freshness = freshnessOf(request.freshness);
      const body = await call(
        news ? "news" : "web",
        {
          q: sites.length > 0 ? `${request.query} (${sites})` : request.query,
          count: String(
            Math.min(request.maxResults, RESEARCH_BOUNDS.maxSearchResults),
          ),
          ...(news ? {} : { extra_snippets: "true" }),
          ...(freshness === null ? {} : { freshness }),
        },
        context,
      );
      const results = listOf(body, news ? ["results"] : ["web", "results"]);
      const hits: PublicWebSearchResult["hits"] = [];
      for (const [index, result] of results.entries()) {
        const link = text(result["url"]);
        if (link === null) continue;
        const verdict = judgePublicUrl(link);
        if (!verdict.ok) continue;
        const extra = Array.isArray(result["extra_snippets"])
          ? result["extra_snippets"].filter(
              (snippet): snippet is string => typeof snippet === "string",
            )
          : [];
        const title = text(result["title"]);
        hits.push({
          url: verdict.url,
          title: title === null ? null : plain(title).slice(0, 300),
          // More of the page than one line: Brave's extra snippets are
          // further passages from it.
          snippet: plain(
            [text(result["description"]) ?? "", ...extra].join(" "),
          ).slice(0, RESEARCH_BOUNDS.maxSnippetChars),
          publishedAt: text(result["page_age"])?.slice(0, 40) ?? null,
          relevance: Math.max(0, 1 - index * 0.05),
        });
        if (hits.length >= RESEARCH_BOUNDS.maxSearchResults) break;
      }
      return { hits, latencyMs: Math.max(0, Date.now() - startedAt) };
    },
    // Brave searches; it does not read pages. The next provider does.
    canReadPages: false,
    extract: () =>
      Promise.reject(
        new ResearchProviderFailure({
          providerCode: "brave",
          failureClass: "VALIDATION",
        }),
      ),
  };
}

export function createBraveImageSearch(
  options: BraveOptions,
): PublicImageSearchProvider {
  const call = createBraveClient(options);
  return {
    code: "brave",
    searchImages: async (query, context) => {
      const body = await call(
        "images",
        { q: query, count: "10", safesearch: "strict" },
        context,
      );
      const hits: PublicImageHit[] = [];
      for (const item of listOf(body, ["results"]).slice(0, 10)) {
        const properties = item["properties"];
        const thumbnail = item["thumbnail"];
        const imageUrl =
          properties !== null && typeof properties === "object"
            ? text((properties as Record<string, unknown>)["url"])
            : null;
        const pageUrl = text(item["url"]);
        if (imageUrl === null || pageUrl === null) continue;
        hits.push({
          imageUrl,
          thumbnailUrl:
            thumbnail !== null && typeof thumbnail === "object"
              ? text((thumbnail as Record<string, unknown>)["src"])
              : null,
          pageUrl,
          title: text(item["title"]),
        });
      }
      return hits;
    },
  };
}
