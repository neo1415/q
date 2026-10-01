import { isKnownPublisher, publisherOf } from "./sources.js";

/**
 * Which gathered items are worth printing, in code (DAILY spec §6): the
 * same item found twice is one story; an item scores for the reader's
 * topics it names, for being recent, for a known business publisher and
 * for the index's own relevance. No model ranks the news.
 */
export type Candidate = {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publisher: string;
  readonly publishedAt: string | null;
  /** The publisher's own feed thumbnail, hotlinked only. */
  readonly thumbnailUrl: string | null;
  /** The search index's relevance (0-1), or null for a feed item. */
  readonly providerRelevance: number | null;
  readonly via: "FEED" | "SEARCH";
};

export type ScoredCandidate = Candidate & {
  readonly score: number;
  /** The topic labels the item names (title or snippet). */
  readonly topicHits: readonly string[];
};

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$)/i;

/** One address per article: host without www, no tracking, no fragment, no trailing slash. */
export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.test(key)) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(/\/+$/, "");
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${path}${query.length > 0 ? `?${query}` : ""}`;
  } catch {
    return value;
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
}

/** The names in a headline: capitalised words after the first. */
function names(text: string): Set<string> {
  const words = text.normalize("NFKD").split(/\s+/).slice(1);
  return new Set(
    words
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((word) => word.length >= 3 && /^\p{Lu}/u.test(word))
      .map((word) => word.toLowerCase()),
  );
}

function figures(text: string): Set<string> {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

function disjoint(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const item of a) if (b.has(item)) return false;
  return true;
}

/**
 * Two headlines about the same event: most longer words shared, and not
 * two different companies or two different figures ("Paystack raises $2
 * million" and "Flutterwave raises $3 million" are two stories).
 */
export function sameStory(a: string, b: string): boolean {
  if (disjoint(names(a), names(b)) || disjoint(figures(a), figures(b))) {
    return false;
  }
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.6;
}

/**
 * Whether a text names a topic: every word of the label, as a whole word.
 * The label is a taxonomy display name or a country name, never somebody's
 * own words.
 */
export function namesTopic(text: string, topic: string): boolean {
  const haystack = ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")} `;
  const words = topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return (
    words.length > 0 && words.every((word) => haystack.includes(` ${word} `))
  );
}

function freshness(publishedAt: string | null, now: Date): number {
  if (publishedAt === null) return 0.05;
  const time = new Date(publishedAt).getTime();
  if (Number.isNaN(time)) return 0.05;
  const days = (now.getTime() - time) / 86_400_000;
  if (days < -1) return 0;
  if (days <= 1) return 0.3;
  if (days <= 3) return 0.2;
  if (days <= 7) return 0.1;
  return 0;
}

export function scoreCandidate(
  candidate: Candidate,
  topics: readonly string[],
  now: Date,
): ScoredCandidate {
  const text = `${candidate.title} ${candidate.snippet}`;
  const topicHits = topics.filter((topic) => namesTopic(text, topic));
  const score =
    Math.min(topicHits.length, 3) * 0.25 +
    freshness(candidate.publishedAt, now) +
    (isKnownPublisher(candidate.url) ? 0.2 : 0) +
    (candidate.providerRelevance ?? 0) * 0.2;
  return { ...candidate, score, topicHits };
}

/**
 * Deduplicated, scored, best first. A feed item must name at least one of
 * the reader's topics (a feed is about everything); a search hit was
 * already found for those topics. Items older than the window are dropped.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  topics: readonly string[],
  options: { readonly now: Date; readonly windowDays: number },
): readonly ScoredCandidate[] {
  const oldest = options.now.getTime() - options.windowDays * 86_400_000;
  const scored = candidates
    .filter((candidate) => {
      if (candidate.publishedAt === null) return candidate.via === "SEARCH";
      const time = new Date(candidate.publishedAt).getTime();
      return Number.isNaN(time) || time >= oldest;
    })
    .map((candidate) => scoreCandidate(candidate, topics, options.now))
    .filter(
      (candidate) =>
        candidate.via === "SEARCH" || candidate.topicHits.length > 0,
    )
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const kept: ScoredCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of scored) {
    const key = canonicalUrl(candidate.url);
    if (seen.has(key)) continue;
    if (kept.some((other) => sameStory(other.title, candidate.title))) continue;
    seen.add(key);
    kept.push(candidate);
  }
  return kept;
}

/** A search hit as a candidate; its publisher named from its address. */
export function candidateFromHit(hit: {
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string;
  readonly publishedAt: string | null;
  readonly relevance: number | null;
}): Candidate | null {
  const title = (hit.title ?? "").trim();
  if (title.length === 0 || !hit.url.startsWith("https://")) return null;
  return {
    url: hit.url,
    title: title.slice(0, 300),
    snippet: hit.snippet.slice(0, 600),
    publisher: publisherOf(hit.url),
    publishedAt: hit.publishedAt,
    thumbnailUrl: null,
    providerRelevance: hit.relevance,
    via: "SEARCH",
  };
}
