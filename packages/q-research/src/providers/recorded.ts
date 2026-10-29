import { z } from "zod";

import {
  PublicWebSearchHitSchema,
  RESEARCH_PROVIDER_CODES,
  RESEARCH_PROVIDER_FAILURE_CLASSES,
  type PublicWebExtractResult,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
  type ResearchProviderCode,
} from "../contracts.js";
import {
  isResearchProviderFailure,
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";

/**
 * Record and replay for the research acceptance gate (owner 2026-10-29).
 *
 * Live runs scored 4/10 and 2/10 while every offline test was green: the
 * tests used invented markets and never pushed a real request through the
 * real egress filter, planner, tiering and report. The gate records each
 * golden case ONCE against the real providers and then replays it in CI
 * with no network.
 *
 * Recording wraps the real provider and keeps only what the provider
 * returned -- each hit's url, title, snippet, date and relevance; each
 * page's url, title and text -- copied field by field, so nothing of
 * Capital Q's own (a person's records, a vendor's raw payload) can ride
 * along. The one thing of ours kept is the query, which is what left
 * Capital Q through the egress filter and is public by construction.
 *
 * Replay serves those recordings by normalised query, and a query or a
 * page the recording does not hold is a MISS: it is listed and, by
 * default, thrown as a plain Error (never a ResearchProviderFailure,
 * which the research service would quietly degrade). A code change that
 * alters what is searched is therefore visible, never silently answered.
 */

export const RECORDED_FIXTURE_VERSION = 1;

/** The key a search is recorded and replayed under. */
export function recordedSearchKey(
  request: Pick<PublicWebSearchRequest, "query"> & {
    readonly includeDomains?: readonly string[] | undefined;
  },
): string {
  const query = request.query.trim().toLowerCase().replace(/\s+/gu, " ");
  const domains = [...(request.includeDomains ?? [])]
    .map((domain) => domain.trim().toLowerCase())
    .sort();
  return domains.length === 0 ? query : `${query} @${domains.join(",")}`;
}

const FailureSchema = z
  .object({ failureClass: z.enum(RESEARCH_PROVIDER_FAILURE_CLASSES) })
  .strict();

const RecordedSearchSchema = z
  .object({
    key: z.string().min(1),
    query: z.string().min(1),
    includeDomains: z.array(z.string()),
    hits: z.array(PublicWebSearchHitSchema),
    failure: FailureSchema.nullable(),
  })
  .strict();

const RecordedPageSchema = z
  .object({
    url: z.string().min(1),
    title: z.string().nullable(),
    text: z.string(),
  })
  .strict();

export const RecordedResearchFixtureSchema = z
  .object({
    version: z.literal(RECORDED_FIXTURE_VERSION),
    providerCode: z.enum(RESEARCH_PROVIDER_CODES),
    recordedAt: z.string().min(1),
    searches: z.array(RecordedSearchSchema),
    pages: z.array(RecordedPageSchema),
    /** Pages the provider could not read when recorded. */
    failedUrls: z.array(z.string()),
    /** Page reads that failed as a whole when recorded. */
    extractFailures: z.array(
      z
        .object({
          urls: z.array(z.string()),
          failureClass: z.enum(RESEARCH_PROVIDER_FAILURE_CLASSES),
        })
        .strict(),
    ),
  })
  .strict();
export type RecordedResearchFixture = z.infer<
  typeof RecordedResearchFixtureSchema
>;

/** Bounds on what a fixture keeps of a page: enough for the gate's checks. */
const PAGE_TEXT_MAX = 60_000;

function copyHit(hit: PublicWebSearchResult["hits"][number]) {
  return {
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet,
    publishedAt: hit.publishedAt,
    relevance: hit.relevance,
  };
}

export type RecordingResearchProvider = PublicWebResearchProvider & {
  /** Everything recorded so far, ready to write as a fixture. */
  readonly fixture: () => RecordedResearchFixture;
};

export function createRecordingResearchProvider(input: {
  readonly provider: PublicWebResearchProvider;
  readonly clock?: (() => Date) | undefined;
}): RecordingResearchProvider {
  const { provider } = input;
  const recordedAt = (input.clock ?? (() => new Date()))().toISOString();
  const searches = new Map<string, z.infer<typeof RecordedSearchSchema>>();
  const pages = new Map<string, z.infer<typeof RecordedPageSchema>>();
  const failed = new Set<string>();
  const extractFailures: RecordedResearchFixture["extractFailures"] = [];
  return {
    get code() {
      return provider.code;
    },
    ...(provider.canSearch === false ? { canSearch: false as const } : {}),
    ...(provider.canReadPages === false
      ? { canReadPages: false as const }
      : {}),
    fixture: () => ({
      version: RECORDED_FIXTURE_VERSION,
      providerCode: provider.code,
      recordedAt,
      searches: [...searches.values()],
      pages: [...pages.values()],
      failedUrls: [...failed],
      extractFailures: [...extractFailures],
    }),
    search: async (request, context) => {
      const key = recordedSearchKey(request);
      const base = {
        key,
        query: request.query,
        includeDomains: [...request.includeDomains],
      };
      try {
        const result = await provider.search(request, context);
        searches.set(key, {
          ...base,
          hits: result.hits.map(copyHit),
          failure: null,
        });
        return result;
      } catch (error) {
        if (isResearchProviderFailure(error))
          searches.set(key, {
            ...base,
            hits: [],
            failure: { failureClass: error.failureClass },
          });
        throw error;
      }
    },
    extract: async (request, context) => {
      // Recorded as the caller saw it (re-recorded case A, 2026-10-29): a
      // read the caller gave up on (its signal fired) is a TIMEOUT for the
      // whole request, and pages arriving after that are not kept. Keeping
      // them made the replay read pages live never did, and every later
      // request missed.
      let settled = false;
      const gaveUp = () => {
        if (settled) return;
        settled = true;
        extractFailures.push({
          urls: [...request.urls],
          failureClass: "TIMEOUT",
        });
      };
      const signal = context?.signal;
      if (signal?.aborted === true) gaveUp();
      signal?.addEventListener("abort", gaveUp, { once: true });
      try {
        const result = await provider.extract(request, context);
        if (settled) return result;
        settled = true;
        for (const page of result.pages)
          pages.set(page.url, {
            url: page.url,
            title: page.title,
            text: page.text.slice(0, PAGE_TEXT_MAX),
          });
        for (const url of result.failedUrls) failed.add(url);
        return result;
      } catch (error) {
        if (!settled && isResearchProviderFailure(error)) {
          settled = true;
          extractFailures.push({
            urls: [...request.urls],
            failureClass: error.failureClass,
          });
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", gaveUp);
      }
    },
  };
}

/** A request the recording does not hold. */
export type RecordedMiss =
  | { readonly kind: "SEARCH"; readonly key: string }
  | { readonly kind: "PAGE"; readonly url: string };

export class RecordedFixtureMiss extends Error {
  readonly miss: RecordedMiss;
  constructor(miss: RecordedMiss) {
    super(
      miss.kind === "SEARCH"
        ? `Research replay: the query "${miss.key}" is not in the recorded fixture. A code change altered what is searched; re-record the case or fix the change.`
        : `Research replay: the page ${miss.url} is not in the recorded fixture. A code change altered which pages are read; re-record the case or fix the change.`,
    );
    this.name = "RecordedFixtureMiss";
    this.miss = miss;
  }
}

export type ReplayResearchProvider = PublicWebResearchProvider & {
  /** Every search request served or missed, in order. */
  readonly searches: readonly PublicWebSearchRequest[];
  /** Requests the recording does not hold. */
  readonly misses: readonly RecordedMiss[];
};

export function createReplayResearchProvider(input: {
  readonly fixture: RecordedResearchFixture;
  /**
   * THROW (default, the CI gate): a miss is thrown and listed. EMPTY (an
   * eval with live models, whose planner may ask anew): a miss returns
   * nothing and is listed; there is never a network call either way.
   */
  readonly onMiss?: "THROW" | "EMPTY" | undefined;
  readonly code?: ResearchProviderCode | undefined;
}): ReplayResearchProvider {
  const fixture = RecordedResearchFixtureSchema.parse(input.fixture);
  const onMiss = input.onMiss ?? "THROW";
  const searchesByKey = new Map(
    fixture.searches.map((search) => [search.key, search] as const),
  );
  const pagesByUrl = new Map(
    fixture.pages.map((page) => [page.url, page] as const),
  );
  const failed = new Set(fixture.failedUrls);
  const sent: PublicWebSearchRequest[] = [];
  const misses: RecordedMiss[] = [];
  const code = input.code ?? fixture.providerCode;
  return {
    code,
    searches: sent,
    misses,
    search: (request) => {
      sent.push(request);
      const key = recordedSearchKey(request);
      const held = searchesByKey.get(key);
      if (held === undefined) {
        const miss = { kind: "SEARCH" as const, key };
        misses.push(miss);
        return onMiss === "THROW"
          ? Promise.reject(new RecordedFixtureMiss(miss))
          : Promise.resolve({ hits: [], latencyMs: 0 });
      }
      if (held.failure !== null)
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: code,
            failureClass: held.failure.failureClass,
          }),
        );
      return Promise.resolve({
        hits: held.hits.slice(0, request.maxResults).map(copyHit),
        latencyMs: 0,
      });
    },
    extract: (request) => {
      const whole = fixture.extractFailures.find(
        (one) =>
          one.urls.length === request.urls.length &&
          one.urls.every((url) => request.urls.includes(url)),
      );
      if (whole !== undefined)
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: code,
            failureClass: whole.failureClass,
          }),
        );
      const result: {
        pages: PublicWebExtractResult["pages"][number][];
        failedUrls: string[];
      } = { pages: [], failedUrls: [] };
      for (const url of request.urls) {
        const page = pagesByUrl.get(url);
        if (page !== undefined) {
          result.pages.push({
            url: page.url,
            title: page.title,
            text: page.text,
          });
          continue;
        }
        if (failed.has(url)) {
          result.failedUrls.push(url);
          continue;
        }
        const miss = { kind: "PAGE" as const, url };
        misses.push(miss);
        if (onMiss === "THROW")
          return Promise.reject(new RecordedFixtureMiss(miss));
        result.failedUrls.push(url);
      }
      return Promise.resolve({ ...result, latencyMs: 0 });
    },
  };
}
