import {
  RESEARCH_BOUNDS,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
} from "../contracts.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";

/**
 * Serper.dev (google.serper.dev) behind the PublicWebResearchProvider
 * port: Google results as JSON from one POST, and its scrape endpoint for
 * reading a page already surfaced by a search. Plain HTTPS; the key travels
 * only in the request header to the vendor.
 */

export type SerperResearchProviderOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  /** Test seam: a scripted fetch instead of the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly searchUrl?: string | undefined;
  readonly scrapeUrl?: string | undefined;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const SEARCH_URL = "https://google.serper.dev/search";
const SCRAPE_URL = "https://scrape.serper.dev";

type Organic = {
  readonly link?: unknown;
  readonly title?: unknown;
  readonly snippet?: unknown;
  readonly date?: unknown;
};

function classify(status: number): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

function tbsFor(freshness: PublicWebSearchRequest["freshness"]): string | null {
  switch (freshness) {
    case "PAST_MONTH":
      return "qdr:m";
    case "PAST_YEAR":
      return "qdr:y";
    case "PAST_WEEK":
      return "qdr:w";
    case "PAST_DAY":
      return "qdr:d";
    case "ANY":
      return null;
  }
}

export function createSerperResearchProvider(
  options: SerperResearchProviderOptions,
): PublicWebResearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failure = (
    failureClass: ResearchProviderFailure["failureClass"],
    status: number | null,
    cause?: unknown,
  ) =>
    new ResearchProviderFailure({
      providerCode: "serper",
      failureClass,
      status,
      cause,
    });

  const post = async (
    url: string,
    body: unknown,
    context: ResearchExecutionContext,
  ): Promise<unknown> => {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (context.signal !== undefined) signals.push(context.signal);
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          "X-API-KEY": options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (error: unknown) {
      throw failure(
        error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "UNAVAILABLE",
        null,
        error,
      );
    }
    if (!response.ok) throw failure(classify(response.status), response.status);
    try {
      return await response.json();
    } catch (error: unknown) {
      throw failure("UNAVAILABLE", response.status, error);
    }
  };

  return {
    code: "serper",
    search: async (request, context) => {
      const startedAt = Date.now();
      // Site restriction is part of the query: Serper has no domain filter.
      const sites = request.includeDomains
        .map((domain) => `site:${domain}`)
        .join(" OR ");
      const tbs = tbsFor(request.freshness);
      const body = await post(
        options.searchUrl ?? SEARCH_URL,
        {
          q: sites.length > 0 ? `${request.query} (${sites})` : request.query,
          num: Math.min(request.maxResults, RESEARCH_BOUNDS.maxSearchResults),
          ...(tbs === null ? {} : { tbs }),
        },
        context,
      );
      const organic =
        body !== null &&
        typeof body === "object" &&
        Array.isArray((body as { organic?: unknown }).organic)
          ? (body as { organic: Organic[] }).organic
          : [];
      const hits: PublicWebSearchResult["hits"] = [];
      for (const [index, result] of organic.entries()) {
        if (typeof result.link !== "string") continue;
        const verdict = judgePublicUrl(result.link);
        if (!verdict.ok) continue;
        hits.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          snippet: (typeof result.snippet === "string"
            ? result.snippet
            : ""
          ).slice(0, RESEARCH_BOUNDS.maxSnippetChars),
          publishedAt:
            typeof result.date === "string" && result.date.length > 0
              ? result.date.slice(0, 40)
              : null,
          relevance: Math.max(0, 1 - index * 0.05),
        });
        if (hits.length >= RESEARCH_BOUNDS.maxSearchResults) break;
      }
      return { hits, latencyMs: Math.max(0, Date.now() - startedAt) };
    },

    extract: async (request, context) => {
      const startedAt = Date.now();
      const pages: { url: string; title: string | null; text: string }[] = [];
      const failedUrls: string[] = [];
      for (const url of request.urls) {
        try {
          const body = await post(
            options.scrapeUrl ?? SCRAPE_URL,
            { url, includeMarkdown: true },
            context,
          );
          const record =
            body !== null && typeof body === "object"
              ? (body as {
                  text?: unknown;
                  markdown?: unknown;
                  metadata?: { title?: unknown };
                })
              : {};
          const text =
            typeof record.markdown === "string" && record.markdown.length > 0
              ? record.markdown
              : typeof record.text === "string"
                ? record.text
                : "";
          if (text.length === 0) {
            failedUrls.push(url);
            continue;
          }
          const title = record.metadata?.title;
          pages.push({
            url,
            title:
              typeof title === "string" && title.length > 0
                ? title.slice(0, 300)
                : null,
            text: text.slice(0, 200_000),
          });
        } catch (error: unknown) {
          if (context.signal?.aborted === true) throw error;
          failedUrls.push(url);
        }
      }
      if (pages.length === 0) throw failure("UNAVAILABLE", null);
      return {
        pages,
        failedUrls,
        latencyMs: Math.max(0, Date.now() - startedAt),
      };
    },
  };
}
