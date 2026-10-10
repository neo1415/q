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
 * ScrapingBee behind the PublicWebResearchProvider port: its Google search
 * API for discovery, and its HTML fetch for reading official pages that
 * Capital Q's own egress cannot reach (a corporate site behind bot
 * protection). The key travels only in the request to the vendor.
 *
 * The Google endpoint is billed at a premium per call, so this index is a
 * fallback or a second opinion, never the fan-out default. The HTML fetch
 * is plain (no JavaScript rendering) unless `renderJs` is set.
 */

export type ScrapingBeeResearchProviderOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  /** Render JavaScript when fetching a page (costs more credits). */
  readonly renderJs?: boolean | undefined;
  /** Test seam: a scripted fetch instead of the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly baseUrl?: string | undefined;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const BASE_URL = "https://app.scrapingbee.com/api/v1";
const MAX_PAGE_CHARS = 200_000;

type GoogleResult = {
  readonly url?: unknown;
  readonly link?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly snippet?: unknown;
  readonly date?: unknown;
};

function classify(status: number): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

/** Visible text of an HTML page: scripts, styles and tags removed. */
export function htmlToText(html: string): {
  readonly title: string | null;
  readonly text: string;
} {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  const text = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;|&#39;/gu, "'")
    .replace(/[ \t\f\v\u00a0]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim();
  return {
    title:
      title === undefined
        ? null
        : title.replace(/\s+/gu, " ").trim().slice(0, 300) || null,
    text: text.slice(0, MAX_PAGE_CHARS),
  };
}

export function createScrapingBeeResearchProvider(
  options: ScrapingBeeResearchProviderOptions,
): PublicWebResearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? BASE_URL;
  const failure = (
    failureClass: ResearchProviderFailure["failureClass"],
    status: number | null,
    cause?: unknown,
  ) =>
    new ResearchProviderFailure({
      providerCode: "scrapingbee",
      failureClass,
      status,
      cause,
    });

  const get = async (
    path: string,
    params: Readonly<Record<string, string>>,
    context: ResearchExecutionContext,
  ): Promise<Response> => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("api_key", options.apiKey);
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (context.signal !== undefined) signals.push(context.signal);
    let response: Response;
    try {
      response = await doFetch(url, { signal: AbortSignal.any(signals) });
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
    return response;
  };

  return {
    code: "scrapingbee",
    search: async (request: PublicWebSearchRequest, context) => {
      const startedAt = Date.now();
      const sites = request.includeDomains
        .map((domain) => `site:${domain}`)
        .join(" OR ");
      const response = await get(
        "/store/google",
        {
          search:
            sites.length > 0 ? `${request.query} (${sites})` : request.query,
          nb_results: String(
            Math.min(request.maxResults, RESEARCH_BOUNDS.maxSearchResults),
          ),
          language: "en",
        },
        context,
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch (error: unknown) {
        throw failure("UNAVAILABLE", response.status, error);
      }
      const record =
        body !== null && typeof body === "object"
          ? (body as { organic_results?: unknown })
          : {};
      const organic: GoogleResult[] = Array.isArray(record.organic_results)
        ? (record.organic_results as GoogleResult[])
        : [];
      const hits: PublicWebSearchResult["hits"] = [];
      for (const [index, result] of organic.entries()) {
        const link =
          typeof result.url === "string"
            ? result.url
            : typeof result.link === "string"
              ? result.link
              : null;
        if (link === null) continue;
        const verdict = judgePublicUrl(link);
        if (!verdict.ok) continue;
        const snippet =
          typeof result.description === "string"
            ? result.description
            : typeof result.snippet === "string"
              ? result.snippet
              : "";
        hits.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          snippet: snippet.slice(0, RESEARCH_BOUNDS.maxSnippetChars),
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
          const response = await get(
            "/",
            { url, render_js: options.renderJs === true ? "true" : "false" },
            context,
          );
          const parsed = htmlToText(await response.text());
          if (parsed.text.length === 0) {
            failedUrls.push(url);
            continue;
          }
          pages.push({ url, title: parsed.title, text: parsed.text });
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
