import { affirmativeText } from "../negation.js";

/**
 * From a sentence to the phrases worth asking the taxonomy about
 * (CQ-Q-VOICE-001 A §5, §10-§11).
 *
 * "We make AI software for freight forwarders and logistics companies."
 * → "ai", "ai software", "software", "freight forwarders", "logistics",
 *   "logistics companies", ...
 *
 * Only affirmative words are used: "we're not fintech" yields no "fintech"
 * phrase, so a negated category can never become a candidate. The phrases
 * are then resolved by Capital Q's own taxonomy classifier — exact label,
 * exact alias, bounded lexical scoring against the canonical vocabularies
 * — and never by a model naming an id. Bounded: at most a few dozen short
 * n-grams per sentence.
 */

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "as",
  "is",
  "are",
  "be",
  "been",
  "was",
  "were",
  "we",
  "we're",
  "our",
  "ours",
  "us",
  "i",
  "i'm",
  "my",
  "you",
  "it",
  "its",
  "it's",
  "this",
  "that",
  "these",
  "those",
  "they",
  "them",
  "their",
  "who",
  "which",
  "what",
  "do",
  "does",
  "did",
  "make",
  "makes",
  "build",
  "builds",
  "building",
  "sell",
  "sells",
  "use",
  "uses",
  "help",
  "helps",
  "provide",
  "provides",
  "offer",
  "offers",
  "run",
  "runs",
  "company",
  "companies",
  "business",
  "businesses",
  "startup",
  "startups",
  "based",
  "currently",
  "mainly",
  "mostly",
  "also",
  "really",
  "just",
  "very",
  "some",
  "about",
  "around",
  "like",
  "so",
  "then",
  "than",
  "there",
  "here",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "raising",
  "raise",
  "round",
  "month",
  "months",
  "year",
  "years",
  "last",
  "next",
]);

export const TAXONOMY_PHRASE_MAX = 24;
const MAX_NGRAM = 3;
const MIN_LENGTH = 2;

function contentTokens(clause: string): readonly string[] {
  return clause
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9+&/-]+$/g, ""))
    .filter((token) => token.length > 0);
}

/** Phrases (1–3 content words) from what the person affirmed, deduplicated, bounded. */
export function taxonomyPhrases(text: string): readonly string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const clause of affirmativeText(text).split(" , ")) {
    const tokens = contentTokens(clause);
    // Runs of content words: a stop word ends a run, so "software for
    // freight forwarders" gives "software" and "freight forwarders".
    const runs: string[][] = [[]];
    for (const token of tokens) {
      if (STOP_WORDS.has(token) || /^\d/.test(token)) {
        runs.push([]);
      } else {
        runs[runs.length - 1]?.push(token);
      }
    }
    for (const run of runs) {
      for (let size = 1; size <= MAX_NGRAM; size += 1) {
        for (let start = 0; start + size <= run.length; start += 1) {
          const phrase = run.slice(start, start + size).join(" ");
          if (phrase.length < MIN_LENGTH || seen.has(phrase)) {
            continue;
          }
          seen.add(phrase);
          phrases.push(phrase);
          if (phrases.length >= TAXONOMY_PHRASE_MAX) {
            return phrases;
          }
        }
      }
    }
  }
  return phrases;
}

/** What the taxonomy answered for one phrase. Public fields of a canonical node only. */
export type TaxonomyPhraseCandidate = {
  readonly nodeId: string;
  readonly displayName: string;
  readonly vocabularyCode: string;
  /** Deterministic indicator in [0, 1] as a decimal string; not a probability. */
  readonly confidence: string;
  /** Matched an exact label or alias (never a lexical guess). */
  readonly exact: boolean;
};

export type AggregatedTaxonomyCandidates = {
  /** Confident enough to propose as a set the person keeps or adjusts. */
  readonly strong: readonly TaxonomyPhraseCandidate[];
  /** A phrase that could mean several categories: offered as a choice, never assumed (§10). */
  readonly ambiguous: readonly TaxonomyPhraseCandidate[];
};

/** A lexical leader this far ahead of the runner-up is the phrase's meaning. */
export const TAXONOMY_CLEAR_MARGIN = 0.1;
/** Below this a lexical leader is not proposed at all. */
export const TAXONOMY_STRONG_CONFIDENCE = 0.5;
/** Below this nothing is even offered as a choice. */
export const TAXONOMY_WEAK_CONFIDENCE = 0.35;
const STRONG_MAX = 8;
const AMBIGUOUS_MAX = 6;

const score = (c: TaxonomyPhraseCandidate): number =>
  Number.parseFloat(c.confidence);

/**
 * Read each phrase's answer on its own, then merge (CQ-Q-VOICE-001 A §5,
 * §10): an exact label or alias settles the phrase; a lexical leader that
 * is clearly ahead settles it; several candidates within a hair of each
 * other are a question for the person ("That could mean a few things
 * here"); a lone weak guess is dropped. One entry per node, best evidence
 * kept, strong before ambiguous.
 */
export function aggregateTaxonomyCandidates(
  results: readonly (readonly TaxonomyPhraseCandidate[])[],
): AggregatedTaxonomyCandidates {
  const strong = new Map<string, TaxonomyPhraseCandidate>();
  const ambiguous = new Map<string, TaxonomyPhraseCandidate>();
  const keepBest = (
    into: Map<string, TaxonomyPhraseCandidate>,
    candidate: TaxonomyPhraseCandidate,
  ): void => {
    const current = into.get(candidate.nodeId);
    if (
      current === undefined ||
      score(candidate) > score(current) ||
      (candidate.exact && !current.exact)
    ) {
      into.set(candidate.nodeId, candidate);
    }
  };
  for (const candidates of results) {
    const exact = candidates.filter((c) => c.exact);
    if (exact.length > 0) {
      for (const c of exact) {
        keepBest(strong, c);
      }
      continue;
    }
    const ranked = [...candidates].sort((a, b) => score(b) - score(a));
    const [top, second] = ranked;
    if (top === undefined || score(top) < TAXONOMY_WEAK_CONFIDENCE) {
      continue;
    }
    const close = ranked.filter(
      (c) => score(top) - score(c) < TAXONOMY_CLEAR_MARGIN,
    );
    if (close.length === 1 || second === undefined) {
      if (score(top) >= TAXONOMY_STRONG_CONFIDENCE) {
        keepBest(strong, top);
      }
      continue;
    }
    for (const c of close) {
      keepBest(ambiguous, c);
    }
  }
  const order = (a: TaxonomyPhraseCandidate, b: TaxonomyPhraseCandidate) =>
    Number(b.exact) - Number(a.exact) ||
    score(b) - score(a) ||
    a.displayName.localeCompare(b.displayName);
  const strongList = [...strong.values()].sort(order).slice(0, STRONG_MAX);
  const strongIds = new Set(strongList.map((c) => c.nodeId));
  const ambiguousList = [...ambiguous.values()]
    .filter((c) => !strongIds.has(c.nodeId))
    .sort(order)
    .slice(0, AMBIGUOUS_MAX);
  return { strong: strongList, ambiguous: ambiguousList };
}
