import type { PublicWebSearchHit } from "../contracts.js";

import { tokenise } from "./egress.js";
import { canonicalUrlKey, publicDomainOf } from "./url-safety.js";

/**
 * Which found pages are read, and how a named subject is recognised in
 * them (web search 2026-10-06). Deterministic and versioned with the
 * service; nothing here decides truth. A page's rank says only that it is
 * worth reading first.
 */

export const RANKING_VERSION = "web-ranking.v1" as const;

/** Sites that publish little beyond what others wrote, or only opinion. */
const LOW_QUALITY_DOMAINS = new Set([
  "pinterest.com",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "reddit.com",
  "medium.com",
  "slideshare.net",
  "scribd.com",
]);

/** Primary or editorially accountable sources for companies and markets. */
const HIGH_QUALITY_DOMAINS = new Set([
  "ycombinator.com",
  "crunchbase.com",
  "techcrunch.com",
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcabal.com",
  "disrupt-africa.com",
  "businessday.ng",
  "pitchbook.com",
  "sec.gov",
  "find-and-update.company-information.service.gov.uk",
  "wikipedia.org",
  "cbinsights.com",
  "dealroom.co",
  "forbes.com",
]);

function registrable(domain: string): string {
  const parts = domain.split(".");
  // "en.wikipedia.org" and "wikipedia.org" are one publisher.
  return parts.length <= 2 ? domain : parts.slice(-2).join(".");
}

/** -0.2 .. +0.2: a page's publisher, as a tiebreak among relevant pages. */
export function sourceQuality(url: string): number {
  const domain = publicDomainOf(url);
  if (domain === null) return -0.2;
  if (
    HIGH_QUALITY_DOMAINS.has(domain) ||
    HIGH_QUALITY_DOMAINS.has(registrable(domain))
  ) {
    return 0.2;
  }
  if (
    LOW_QUALITY_DOMAINS.has(domain) ||
    LOW_QUALITY_DOMAINS.has(registrable(domain))
  ) {
    return -0.15;
  }
  if (domain.endsWith(".gov") || domain.includes(".gov.")) return 0.15;
  return 0;
}

/** 0 .. +0.15: newer is better, undated is neutral, never a penalty for age alone. */
export function recencyBoost(publishedAt: string | null, now: Date): number {
  if (publishedAt === null) return 0;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return 0;
  const days = (now.getTime() - time) / 86_400_000;
  if (days < 0) return 0;
  if (days <= 31) return 0.15;
  if (days <= 365) return 0.08;
  return 0;
}

export type FoundHit = PublicWebSearchHit & {
  /** How many of this turn's planned queries surfaced the page. */
  readonly foundBy: number;
};

/**
 * Hits from every planned query as one list, one per canonical URL. A page
 * several differently-worded queries found is likelier to be about the
 * question.
 */
export function mergePlannedHits(
  lists: readonly (readonly PublicWebSearchHit[])[],
): readonly FoundHit[] {
  const byKey = new Map<string, FoundHit>();
  for (const list of lists) {
    for (const hit of list) {
      const key = canonicalUrlKey(hit.url);
      const existing = byKey.get(key);
      byKey.set(
        key,
        existing === undefined
          ? { ...hit, foundBy: 1 }
          : {
              ...existing,
              title: existing.title ?? hit.title,
              snippet:
                existing.snippet.length > 0 ? existing.snippet : hit.snippet,
              publishedAt: existing.publishedAt ?? hit.publishedAt,
              relevance: Math.max(existing.relevance ?? 0, hit.relevance ?? 0),
              foundBy: existing.foundBy + 1,
            },
      );
    }
  }
  return [...byKey.values()];
}

/** Relevance, agreement between queries, publisher and recency, in that order of weight. */
export function scoreHit(hit: FoundHit, now: Date): number {
  return (
    (hit.relevance ?? 0) +
    0.15 * Math.min(2, hit.foundBy - 1) +
    sourceQuality(hit.url) +
    recencyBoost(hit.publishedAt, now)
  );
}

/** The pages worth reading, best first, at most `perDomain` from one publisher. */
export function rankForReading(
  hits: readonly FoundHit[],
  count: number,
  now: Date,
  perDomain: number,
): readonly FoundHit[] {
  const ordered = [...hits].sort((a, b) => scoreHit(b, now) - scoreHit(a, now));
  const used = new Map<string, number>();
  const chosen: FoundHit[] = [];
  for (const hit of ordered) {
    const domain = publicDomainOf(hit.url) ?? hit.url;
    const taken = used.get(domain) ?? 0;
    if (taken >= perDomain) continue;
    used.set(domain, taken + 1);
    chosen.push(hit);
    if (chosen.length >= count) break;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Entity resolution: is this page about the subject that was named?
// ---------------------------------------------------------------------------

export const SUBJECT_MATCHES = ["MATCH", "POSSIBLE", "NONE"] as const;
export type SubjectMatch = (typeof SUBJECT_MATCHES)[number];

export const ENTITY_RESOLUTIONS = [
  "RESOLVED",
  "AMBIGUOUS",
  "NOT_FOUND",
  "NOT_APPLICABLE",
] as const;
export type EntityResolutionStatus = (typeof ENTITY_RESOLUTIONS)[number];

export type NamedEntity = {
  readonly name: string;
  /** Its own site's domain, when Capital Q holds one the actor may use. */
  readonly domain: string | null;
  /** ISO code, when held and authorised. */
  readonly country: string | null;
};

const NAME_NOISE = new Set([
  "inc",
  "ltd",
  "limited",
  "llc",
  "plc",
  "co",
  "company",
  "corp",
  "corporation",
  "group",
  "holdings",
  "the",
  "and",
  "&",
]);

function nameTokens(name: string): readonly string[] {
  return tokenise(name).filter((token) => !NAME_NOISE.has(token));
}

/** True when every word of the name appears, in order, in the text. */
export function textNames(text: string, name: string): boolean {
  const wanted = nameTokens(name);
  if (wanted.length === 0) return false;
  const words = tokenise(text);
  for (let start = 0; start <= words.length - wanted.length; start += 1) {
    if (wanted.every((token, offset) => words[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

/** A domain that looks like the subject's own: its label is the name run together. */
export function looksLikeOwnDomain(domain: string, name: string): boolean {
  const compact = nameTokens(name).join("");
  if (compact.length < 3) return false;
  const label = (domain.split(".")[0] ?? "").replace(/-/gu, "");
  return label === compact || label.startsWith(compact);
}

export type ResolvedSource = {
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly text: string;
  readonly countries: readonly string[];
};

/**
 * Whether a page is about the named subject. MATCH: its own site, or a page
 * that names it and (when a country is known) does not place it elsewhere.
 * POSSIBLE: names it, but places it in another country, so it may be a
 * different organisation of the same name. NONE: does not name it.
 */
export function matchOf(
  source: ResolvedSource,
  entity: NamedEntity,
): SubjectMatch {
  if (
    entity.domain !== null &&
    registrable(source.domain) === registrable(entity.domain)
  ) {
    return "MATCH";
  }
  const named =
    textNames(`${source.title ?? ""} ${source.text}`, entity.name) ||
    looksLikeOwnDomain(source.domain, entity.name);
  if (!named) return "NONE";
  if (
    entity.country !== null &&
    source.countries.length > 0 &&
    !source.countries.includes(entity.country)
  ) {
    return "POSSIBLE";
  }
  return "MATCH";
}

export type EntityResolution = {
  readonly status: EntityResolutionStatus;
  /** Sites that each look like a different organisation's own, when ambiguous. */
  readonly candidates: readonly string[];
};

/**
 * Whether the pages read settle which organisation the name refers to.
 * Several sites that each look like the subject's own site, with no held
 * domain to choose between them, or only pages that place it elsewhere,
 * is AMBIGUOUS: Q says what it found and asks, rather than attributing.
 */
export function resolveEntity(
  sources: readonly ResolvedSource[],
  entity: NamedEntity | null,
): EntityResolution {
  if (entity === null || nameTokens(entity.name).length === 0) {
    return { status: "NOT_APPLICABLE", candidates: [] };
  }
  const matches = sources.map((source) => ({
    source,
    match: matchOf(source, entity),
  }));
  if (
    entity.domain !== null &&
    matches.some(
      ({ source }) =>
        registrable(source.domain) === registrable(entity.domain ?? ""),
    )
  ) {
    return { status: "RESOLVED", candidates: [] };
  }
  const ownSites = [
    ...new Set(
      matches
        .filter(
          ({ source, match }) =>
            match !== "NONE" && looksLikeOwnDomain(source.domain, entity.name),
        )
        .map(({ source }) => registrable(source.domain)),
    ),
  ];
  if (entity.domain === null && ownSites.length >= 2) {
    return { status: "AMBIGUOUS", candidates: ownSites.slice(0, 4) };
  }
  if (matches.some(({ match }) => match === "MATCH")) {
    return { status: "RESOLVED", candidates: [] };
  }
  if (matches.some(({ match }) => match === "POSSIBLE")) {
    return {
      status: "AMBIGUOUS",
      candidates: [
        ...new Set(
          matches
            .filter(({ match }) => match === "POSSIBLE")
            .map(({ source }) => registrable(source.domain)),
        ),
      ].slice(0, 4),
    };
  }
  return { status: "NOT_FOUND", candidates: [] };
}
