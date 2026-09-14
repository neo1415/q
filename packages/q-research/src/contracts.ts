import { z } from "zod";

/**
 * Provider-neutral contracts for controlled public-web research
 * (CQ-Q-RESEARCH-001 §7-§8, §36).
 *
 * Two operations only — discover sources (search) and read a source
 * (extract) — with conservative, typed bounds. Nothing here is a vendor
 * type: a provider adapter translates its own DTOs into these and never
 * lets a request id, score model or raw payload through. A result is
 * public material of unknown reliability; it is never a fact.
 */

/** Per Q research turn (§8, §36). */
export const RESEARCH_BOUNDS = {
  /** Search calls a single research turn may make, including a refinement. */
  maxSearchCalls: 2,
  /** Search results considered per turn. */
  maxSearchResults: 5,
  /** Sources extracted by default. */
  defaultExtractCount: 3,
  /** Hard upper bound on sources extracted per turn. */
  maxExtractCount: 5,
  /** Characters of extracted text kept per source (fits an evidence item summary). */
  maxExcerptChars: 2_000,
  /** Characters of a search snippet kept. */
  maxSnippetChars: 600,
  /** Query length after composition. */
  maxQueryChars: 200,
  /** Domains a caller may pin a search to. */
  maxIncludeDomains: 3,
} as const;

export const PUBLIC_WEB_FRESHNESS = ["ANY", "PAST_YEAR", "PAST_MONTH"] as const;
export const PublicWebFreshnessSchema = z.enum(PUBLIC_WEB_FRESHNESS);
export type PublicWebFreshness = z.infer<typeof PublicWebFreshnessSchema>;

/** A public URL string, already normalised and judged safe by `url-safety`. */
export const PublicUrlSchema = z.string().url().max(2_048);

export const PublicWebSearchRequestSchema = z
  .object({
    /** The composed, minimised query. Never raw model or conversation text. */
    query: z.string().trim().min(1).max(RESEARCH_BOUNDS.maxQueryChars),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(RESEARCH_BOUNDS.maxSearchResults)
      .default(RESEARCH_BOUNDS.maxSearchResults),
    freshness: PublicWebFreshnessSchema.default("ANY"),
    includeDomains: z
      .array(z.string().trim().min(1).max(253))
      .max(RESEARCH_BOUNDS.maxIncludeDomains)
      .default([]),
  })
  .strict();
export type PublicWebSearchRequest = z.infer<
  typeof PublicWebSearchRequestSchema
>;

export const PublicWebSearchHitSchema = z
  .object({
    url: PublicUrlSchema,
    title: z.string().max(300).nullable(),
    snippet: z.string().max(RESEARCH_BOUNDS.maxSnippetChars),
    /** ISO date or timestamp when the provider states one; otherwise null. */
    publishedAt: z.string().max(40).nullable(),
    /** Provider relevance, 0..1, for ordering only. Never surfaced as a fact. */
    relevance: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type PublicWebSearchHit = z.infer<typeof PublicWebSearchHitSchema>;

export const PublicWebSearchResultSchema = z
  .object({
    hits: z
      .array(PublicWebSearchHitSchema)
      .max(RESEARCH_BOUNDS.maxSearchResults),
    /** Milliseconds the provider took, for telemetry. */
    latencyMs: z.number().int().min(0),
  })
  .strict();
export type PublicWebSearchResult = z.infer<typeof PublicWebSearchResultSchema>;

export const PublicWebExtractRequestSchema = z
  .object({
    urls: z.array(PublicUrlSchema).min(1).max(RESEARCH_BOUNDS.maxExtractCount),
  })
  .strict();
export type PublicWebExtractRequest = z.infer<
  typeof PublicWebExtractRequestSchema
>;

export const PublicWebExtractedPageSchema = z
  .object({
    url: PublicUrlSchema,
    title: z.string().max(300).nullable(),
    /** Plain text or markdown as the provider returned it; bounded by the service. */
    text: z.string().max(200_000),
  })
  .strict();
export type PublicWebExtractedPage = z.infer<
  typeof PublicWebExtractedPageSchema
>;

export const PublicWebExtractResultSchema = z
  .object({
    pages: z
      .array(PublicWebExtractedPageSchema)
      .max(RESEARCH_BOUNDS.maxExtractCount),
    /** URLs the provider could not read. Never an error message. */
    failedUrls: z.array(PublicUrlSchema).max(RESEARCH_BOUNDS.maxExtractCount),
    latencyMs: z.number().int().min(0),
  })
  .strict();
export type PublicWebExtractResult = z.infer<
  typeof PublicWebExtractResultSchema
>;

/** Stable, vendor-neutral failure classes a provider adapter may report. */
export const RESEARCH_PROVIDER_FAILURE_CLASSES = [
  "AUTHENTICATION",
  "RATE_LIMIT",
  "TIMEOUT",
  "UNAVAILABLE",
  "VALIDATION",
] as const;
export type ResearchProviderFailureClass =
  (typeof RESEARCH_PROVIDER_FAILURE_CLASSES)[number];

/** The provider code recorded on evidence sources (`evidence.sources.provider`). */
export const RESEARCH_PROVIDER_CODES = ["tavily", "fake"] as const;
export type ResearchProviderCode = (typeof RESEARCH_PROVIDER_CODES)[number];
