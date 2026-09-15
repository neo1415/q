import { z } from "zod";

import {
  RESEARCH_BOUNDS,
  type PublicProfileLookupRequest,
  type PublicProfileLookupResult,
  type PublicWebExtractResult,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
} from "../contracts.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicProfileLookupProvider,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";

/**
 * Bright Data as a research provider (CQ-Q-RESEARCH-001, rework):
 *
 *   - SERP API: a Google search through a named zone, parsed results.
 *   - Web Unlocker: a public page fetched as markdown through a named zone.
 *   - LinkedIn datasets: one public person or company page, by URL, through
 *     the provider's compliant scraper (`/datasets/v3/scrape`).
 *
 * The same rules as every provider: what leaves Capital Q is composed by
 * the research capability, never taken from a model's argument; what comes
 * back is untrusted public material; a failure is classified, never
 * relayed. Everything is bounded before it is returned.
 */

const REQUEST_URL = "https://api.brightdata.com/request";
const SCRAPE_URL = "https://api.brightdata.com/datasets/v3/scrape";
const LINKEDIN_PEOPLE_DATASET = "gd_l1viktl72bvl7bjuj0";
const LINKEDIN_COMPANY_DATASET = "gd_l1vikfnt1wgvvqz95w";
const DEFAULT_TIMEOUT_MS = 25_000;
const PROFILE_TIMEOUT_MS = 70_000;

export type BrightDataOptions = {
  readonly apiKey: string;
  readonly serpZone: string;
  readonly unlockerZone: string;
  readonly timeoutMs?: number | undefined;
  /** Test seam. */
  readonly fetch?: typeof fetch | undefined;
};

export type BrightDataProfileOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
};

export function classifyBrightDataStatus(
  status: number,
): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

function failure(
  failureClass: ResearchProviderFailure["failureClass"],
  status: number | null,
  cause?: unknown,
): ResearchProviderFailure {
  return new ResearchProviderFailure({
    providerCode: "brightdata",
    failureClass,
    status,
    cause,
  });
}

async function post(
  doFetch: typeof fetch,
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  context: ResearchExecutionContext,
): Promise<{ readonly status: number; readonly text: string }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal =
    context.signal === undefined
      ? timeout
      : AbortSignal.any([context.signal, timeout]);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    if (timeout.aborted || context.signal?.aborted === true) {
      throw failure("TIMEOUT", null, error);
    }
    throw failure("UNAVAILABLE", null, error);
  }
  const text = await response.text();
  if (!response.ok) {
    throw failure(classifyBrightDataStatus(response.status), response.status);
  }
  return { status: response.status, text };
}

/** The SERP API's parsed Google page, the parts a search hit needs. */
const SerpSchema = z
  .object({
    organic: z
      .array(
        z
          .object({
            link: z.string(),
            title: z.string().nullish(),
            description: z.string().nullish(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

function parseSerp(text: string): z.infer<typeof SerpSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    throw failure("UNAVAILABLE", null, error);
  }
  // With format "json" the page arrives wrapped; with brd_json the body is
  // the parsed page itself. Accept both.
  const wrapped = z.object({ body: z.string() }).safeParse(raw);
  if (wrapped.success) {
    try {
      raw = JSON.parse(wrapped.data.body);
    } catch (error: unknown) {
      throw failure("UNAVAILABLE", null, error);
    }
  }
  const parsed = SerpSchema.safeParse(raw);
  if (!parsed.success) {
    throw failure("UNAVAILABLE", null, parsed.error);
  }
  return parsed.data;
}

function googleUrl(request: PublicWebSearchRequest): string {
  const site =
    request.includeDomains !== undefined && request.includeDomains.length > 0
      ? ` (${request.includeDomains.map((d) => `site:${d}`).join(" OR ")})`
      : "";
  const params = new URLSearchParams({
    q: `${request.query}${site}`,
    num: String(Math.min(request.maxResults, RESEARCH_BOUNDS.maxSearchResults)),
    brd_json: "1",
  });
  if (request.freshness === "PAST_MONTH") params.set("tbs", "qdr:m");
  if (request.freshness === "PAST_YEAR") params.set("tbs", "qdr:y");
  return `https://www.google.com/search?${params.toString()}`;
}

export function createBrightDataResearchProvider(
  options: BrightDataOptions,
): PublicWebResearchProvider {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    code: "brightdata",
    search: async (request, context) => {
      const startedAt = Date.now();
      const { text } = await post(
        doFetch,
        REQUEST_URL,
        options.apiKey,
        { zone: options.serpZone, url: googleUrl(request), format: "raw" },
        timeoutMs,
        context,
      );
      const page = parseSerp(text);
      const hits: PublicWebSearchResult["hits"] = [];
      for (const result of page.organic) {
        const verdict = judgePublicUrl(result.link);
        if (!verdict.ok) continue;
        hits.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          snippet: (result.description ?? "").slice(
            0,
            RESEARCH_BOUNDS.maxSnippetChars,
          ),
          publishedAt: null,
          relevance: null,
        });
        if (hits.length >= RESEARCH_BOUNDS.maxSearchResults) break;
      }
      return { hits, latencyMs: Date.now() - startedAt };
    },
    extract: async (request, context) => {
      const startedAt = Date.now();
      const pages: PublicWebExtractResult["pages"] = [];
      const failed: string[] = [];
      for (const url of request.urls.slice(
        0,
        RESEARCH_BOUNDS.maxExtractCount,
      )) {
        const verdict = judgePublicUrl(url);
        if (!verdict.ok) {
          failed.push(url);
          continue;
        }
        try {
          const { text } = await post(
            doFetch,
            REQUEST_URL,
            options.apiKey,
            {
              zone: options.unlockerZone,
              url: verdict.url,
              format: "raw",
              data_format: "markdown",
            },
            timeoutMs,
            context,
          );
          const heading = /^#\s+(.+)$/m.exec(text);
          pages.push({
            url: verdict.url,
            title: heading?.[1]?.trim().slice(0, 300) ?? null,
            text: text.slice(0, 200_000),
          });
        } catch (error: unknown) {
          if (
            error instanceof ResearchProviderFailure &&
            (error.failureClass === "AUTHENTICATION" ||
              error.failureClass === "RATE_LIMIT")
          ) {
            throw error;
          }
          failed.push(verdict.url);
        }
      }
      return { pages, failedUrls: failed, latencyMs: Date.now() - startedAt };
    },
  };
}

/** Which LinkedIn page a URL names, if it is one at all. */
export function linkedInPageKind(
  url: string,
): { readonly kind: "PERSON" | "COMPANY"; readonly url: string } | null {
  const verdict = judgePublicUrl(url);
  if (!verdict.ok) return null;
  let parsed: URL;
  try {
    parsed = new URL(verdict.url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (/^\/in\/[^/]+$/.test(path)) {
    return { kind: "PERSON", url: `https://www.linkedin.com${path}` };
  }
  if (/^\/company\/[^/]+$/.test(path)) {
    return { kind: "COMPANY", url: `https://www.linkedin.com${path}` };
  }
  return null;
}

const text = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim().slice(0, max) : null))
    .pipe(z.string().nullable());
const count = z
  .unknown()
  .optional()
  .transform((v) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null,
  )
  .pipe(z.number().int().nullable());
const list = (max: number, each: number) =>
  z
    .unknown()
    .optional()
    .transform((v) =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().slice(0, each))
            .slice(0, max)
        : [],
    )
    .pipe(z.array(z.string()));

const CompanyRecordSchema = z
  .object({
    name: text(200),
    about: text(2_000),
    website: text(2_048),
    industries: z
      .unknown()
      .optional()
      .transform((v) =>
        typeof v === "string"
          ? [v.trim().slice(0, 120)]
          : Array.isArray(v)
            ? v
                .filter((x): x is string => typeof x === "string")
                .map((x) => x.trim().slice(0, 120))
                .slice(0, 10)
            : [],
      ),
    company_size: text(60),
    headquarters: text(200),
    country_code: text(40),
    followers: count,
    employees_in_linkedin: count,
    founded: z
      .unknown()
      .optional()
      .transform((v) =>
        typeof v === "number" || typeof v === "string"
          ? String(v).slice(0, 40)
          : null,
      ),
    locations: list(6, 200),
  })
  .passthrough();

const PersonRecordSchema = z
  .object({
    name: text(200),
    position: text(300),
    about: text(2_000),
    city: text(120),
    country_code: text(8),
    followers: count,
    connections: count,
    current_company: z
      .unknown()
      .optional()
      .transform((v) => {
        if (v === null || typeof v !== "object") return null;
        const o = v as Record<string, unknown>;
        const name =
          typeof o["name"] === "string" ? o["name"].slice(0, 200) : null;
        const title =
          typeof o["title"] === "string" ? o["title"].slice(0, 200) : null;
        return name === null && title === null ? null : { name, title };
      }),
    experience: z
      .unknown()
      .optional()
      .transform((v) =>
        Array.isArray(v)
          ? v.slice(0, 8).map((item) => {
              const o =
                item !== null && typeof item === "object"
                  ? (item as Record<string, unknown>)
                  : {};
              return {
                title:
                  typeof o["title"] === "string"
                    ? o["title"].slice(0, 200)
                    : null,
                company:
                  typeof o["company"] === "string"
                    ? o["company"].slice(0, 200)
                    : null,
                period: [o["start_date"], o["end_date"]]
                  .filter((d): d is string => typeof d === "string")
                  .join(" – ")
                  .slice(0, 60),
              };
            })
          : [],
      ),
  })
  .passthrough();

export function createBrightDataProfileLookup(
  options: BrightDataProfileOptions,
): PublicProfileLookupProvider {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROFILE_TIMEOUT_MS;
  return {
    code: "brightdata",
    lookup: async (
      request: PublicProfileLookupRequest,
      context: ResearchExecutionContext,
    ): Promise<PublicProfileLookupResult> => {
      const page = linkedInPageKind(request.url);
      if (page === null) {
        return { status: "NOT_LINKEDIN", profile: null };
      }
      const dataset =
        page.kind === "PERSON"
          ? LINKEDIN_PEOPLE_DATASET
          : LINKEDIN_COMPANY_DATASET;
      const { status, text: body } = await post(
        doFetch,
        `${SCRAPE_URL}?dataset_id=${dataset}&format=json`,
        options.apiKey,
        [{ url: page.url }],
        timeoutMs,
        context,
      );
      if (status === 202) {
        return { status: "PENDING", profile: null };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch (error: unknown) {
        throw failure("UNAVAILABLE", null, error);
      }
      const first: unknown = Array.isArray(raw) ? (raw[0] as unknown) : raw;
      if (first === null || typeof first === "undefined") {
        return { status: "NOT_FOUND", profile: null };
      }
      const retrievedAt = new Date().toISOString();
      if (page.kind === "COMPANY") {
        const parsed = CompanyRecordSchema.safeParse(first);
        if (!parsed.success || parsed.data.name === null) {
          return { status: "NOT_FOUND", profile: null };
        }
        const c = parsed.data;
        return {
          status: "FOUND",
          profile: {
            kind: "COMPANY",
            url: page.url,
            name: c.name,
            about: c.about,
            website: c.website,
            industries: c.industries,
            companySize: c.company_size,
            headquarters: c.headquarters ?? c.locations[0] ?? null,
            countryCodes:
              c.country_code === null
                ? []
                : c.country_code
                    .split(",")
                    .map((x) => x.trim())
                    .filter((x) => x.length > 0)
                    .slice(0, 10),
            followers: c.followers,
            employeesOnLinkedIn: c.employees_in_linkedin,
            founded: c.founded,
            retrievedAt,
          },
        };
      }
      const parsed = PersonRecordSchema.safeParse(first);
      if (!parsed.success || parsed.data.name === null) {
        return { status: "NOT_FOUND", profile: null };
      }
      const p = parsed.data;
      return {
        status: "FOUND",
        profile: {
          kind: "PERSON",
          url: page.url,
          name: p.name,
          headline: p.position,
          about: p.about,
          location:
            [p.city, p.country_code]
              .filter((x): x is string => x !== null)
              .join(", ")
              .slice(0, 200) || null,
          currentCompany: p.current_company,
          followers: p.followers,
          connections: p.connections,
          experience: p.experience,
          retrievedAt,
        },
      };
    },
  };
}
