import { RESEARCH_BOUNDS } from "../contracts.js";

/**
 * The outbound Context Firewall for research (CQ-Q-RESEARCH-001 §9-§10).
 *
 * Q having private context does not mean a provider receives it. A query
 * that leaves Capital Q is COMPOSED here from an allowlist, never forwarded:
 *
 *   - the person's own words in the message that asked (explicit wording);
 *   - the subject's public identity, when policy has authorised it
 *     (a network-visible or public company's name, a declared website's
 *     domain, a public headquarters country, an investor's public name);
 *   - the name of whom the turn is about, when Q itself showed that name
 *     to the person in this conversation and they pointed back at it ("the
 *     top one", "them"): the name only, never other words of Q's;
 *   - short connective words.
 *
 * Anything else the model put in its proposed query — a figure from a deck,
 * a customer name, a mandate constraint, an identifier — is dropped before
 * egress. Money-like figures are dropped even when the person typed them,
 * unless they are part of an authorised public identity. When nothing
 * survives, the query falls back to the public identity alone; when there
 * is no public identity either, the research is refused rather than sent.
 *
 * This is deliberately a whitelist: it cannot recognise a private fact by
 * its shape, so it never tries to. It recognises what is allowed to leave.
 */

export type EgressInput = {
  /** What the model asked to search for. Untrusted. */
  readonly requestedQuery: string;
  /** The person's latest message in this conversation. Their explicit wording. */
  readonly userText: string;
  /**
   * The person's own earlier messages in this conversation, most recent
   * last (web search 2026-10-06: "look her up" after naming Mai Soli a
   * turn before had nothing to search for). Their words too, never Q's.
   */
  readonly earlierUserText?: readonly string[] | undefined;
  /** Public identity terms policy has authorised for this subject, if any. */
  readonly publicIdentity: readonly string[];
  /**
   * Whether the first identity term is put in front of the person's words
   * when they did not name the subject. True for a company that IS the
   * conversation's subject ("what do they say about us"). False when the
   * identity is the person's own organisation and the question is about
   * someone else: the identity stays an allowed token and a fallback, but
   * an investor asking about a company must not have their own name sent
   * as the subject of the search. Default true.
   */
  readonly prependIdentity?: boolean | undefined;
  /**
   * Names of whom the turn is about that Q showed the person in this
   * conversation (owner 2026-10-23: "if they say the top one, find out who
   * the top one is and search that"). Each is checked by `namesShown`
   * against Q's own earlier words, so a model cannot name somebody new to
   * look up; each may leave whole, like a public identity.
   */
  readonly shownNames?: readonly string[] | undefined;
  /**
   * Deep research (owner 2026-10-23): words read on public pages this run
   * already surfaced (titles and excerpts of sources it searched). They are
   * public by where they came from, so a follow-up query may name what
   * those pages named (a competitor, a regulator) although the person did
   * not. Figures among them are still never sent.
   */
  readonly publicTerms?: readonly string[] | undefined;
  /**
   * Deep research: the generic words of a research question ("statistics",
   * "regulation", "pricing") may travel. They describe what kind of page is
   * wanted and say nothing about anyone; on their own they never make a
   * query informative.
   */
  readonly researchVocabulary?: boolean | undefined;
};

export type EgressOutcome =
  | {
      readonly ok: true;
      readonly query: string;
      /** Tokens of the requested query that were not allowed to leave. */
      readonly droppedTokens: number;
      /** True when the requested query could not be used and the identity alone was sent. */
      readonly fellBackToIdentity: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "NOTHING_SAFE_TO_SEND";
      readonly droppedTokens: number;
    };

/** Words that carry no information and may always travel. */
const CONNECTIVES = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "for",
  "to",
  "and",
  "or",
  "about",
  "with",
  "from",
  "by",
  "is",
  "are",
  "was",
  "were",
  "latest",
  "recent",
  "news",
  "current",
  "company",
  "startup",
  "public",
  "information",
  "website",
  "site",
  "who",
  "what",
  "where",
  "when",
  "which",
  "how",
  "does",
  "do",
  "did",
  "its",
  "their",
  "our",
  "my",
  "your",
  "this",
  "that",
  "these",
  "those",
  "vs",
  "versus",
  "review",
  "reviews",
  "funding",
  "founders",
  "founder",
  "ceo",
  "team",
  "product",
  "market",
  "markets",
  "customers",
  "partnership",
  "partnerships",
  "press",
  "announcement",
  "announcements",
  "profile",
  // Public professional profiles are what a search for a team finds
  // (owner 2026-10-23); the word names a site, nothing about anyone.
  "linkedin",
  "overview",
  "history",
  "2024",
  "2025",
  "2026",
  "africa",
  "african",
]);

/**
 * The vocabulary of a market-research question: kinds of evidence and
 * kinds of page, never a fact about a person or company. Used only when a
 * caller asks for it (deep research), as an egress allowance -- it never
 * decides what is researched; the planner's reading of the request does.
 */
export const RESEARCH_VOCABULARY: ReadonlySet<string> = new Set([
  "size",
  "sizing",
  "share",
  "growth",
  "trend",
  "trends",
  "forecast",
  "statistics",
  "data",
  "survey",
  "report",
  "study",
  "analysis",
  "industry",
  "sector",
  "segment",
  "segments",
  "demand",
  "supply",
  "access",
  "households",
  "household",
  "population",
  "urban",
  "rural",
  "informal",
  "settlements",
  "consumers",
  "consumer",
  "users",
  "competitors",
  "competition",
  "competitive",
  "landscape",
  "alternatives",
  "substitutes",
  "players",
  "operators",
  "providers",
  "startups",
  "regulation",
  "regulations",
  "regulator",
  "regulatory",
  "policy",
  "licensing",
  "licence",
  "license",
  "tariff",
  "tariffs",
  "tax",
  "government",
  "pricing",
  "price",
  "prices",
  "cost",
  "costs",
  "per",
  "unit",
  "economics",
  "margin",
  "margins",
  "revenue",
  "benchmark",
  "benchmarks",
  "business",
  "model",
  "models",
  "investment",
  "investors",
  "raised",
  "acquisition",
  "expansion",
  "case",
  "impact",
  "adoption",
  "penetration",
  "annual",
  "monthly",
  "daily",
  "average",
  "estimate",
  "estimates",
]);

/** A figure or money-like token: "2.4m", "$700k", "3,000,000", "USD". */
const FIGURE_LIKE =
  /^(?:[$£€]|usd|gbp|eur|ngn|kes|zar)?\d[\d.,]*(?:k|m|mn|bn|b|%)?$/i;

const YEAR = /^20[0-3]\d$/u;

/** A joining word ("the", "of"): never a search on its own. */
export function isConnective(token: string): boolean {
  return CONNECTIVES.has(token);
}

export function tokenise(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_$£€.'&-]+/gu, " ")
    .split(" ")
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((token) => token.length > 0);
}

/**
 * A word and its plain singular or plural ("kiosk", "kiosks"): the same
 * word, so allowing one allows the other. Adds no information.
 */
function numberVariants(token: string): readonly string[] {
  if (!/^\p{L}+$/u.test(token) || token.length < 3) return [token];
  return token.endsWith("s") && token.length > 3
    ? [token, token.slice(0, -1)]
    : [token, `${token}s`];
}

/** Deep research only: everyday research keeps exact words (egress.test). */
function variantsFor(input: EgressInput): (token: string) => readonly string[] {
  return input.researchVocabulary === true
    ? numberVariants
    : (token) => [token];
}

function allowedSet(input: EgressInput): ReadonlySet<string> {
  const allowed = new Set<string>(CONNECTIVES);
  const variants = variantsFor(input);
  for (const token of personTokens(input)) {
    if (!FIGURE_LIKE.test(token)) {
      for (const variant of variants(token)) allowed.add(variant);
    }
  }
  for (const term of [...input.publicIdentity, ...(input.shownNames ?? [])]) {
    for (const token of tokenise(term)) {
      allowed.add(token);
    }
  }
  const years = input.researchVocabulary === true;
  for (const token of publicTokens(input)) {
    if (!FIGURE_LIKE.test(token))
      for (const variant of variants(token)) allowed.add(variant);
    else if (years && YEAR.test(token)) allowed.add(token);
  }
  if (input.researchVocabulary === true) {
    for (const token of RESEARCH_VOCABULARY) allowed.add(token);
  }
  return allowed;
}

/**
 * The names among `candidates` that Q itself showed the person: every word
 * of the name is in Q's earlier messages in this conversation. A name the
 * reader resolved from "the top one" passes; one nobody said does not.
 */
export function namesShown(
  candidates: readonly (string | null | undefined)[],
  shownText: readonly string[] | undefined,
): readonly string[] {
  if (shownText === undefined || shownText.length === 0) return [];
  const shown = new Set(shownText.flatMap((text) => tokenise(text)));
  return candidates.flatMap((candidate) => {
    const name = candidate?.trim() ?? "";
    const words = tokenise(name);
    return words.length > 0 && words.every((word) => shown.has(word))
      ? [name]
      : [];
  });
}

/** Words from public pages this run already read (deep research). */
function publicTokens(input: EgressInput): readonly string[] {
  return (input.publicTerms ?? []).flatMap((text) => tokenise(text));
}

/** Every word the person wrote this turn and in their earlier messages. */
function personTokens(input: EgressInput): readonly string[] {
  return [input.userText, ...(input.earlierUserText ?? [])].flatMap((text) =>
    tokenise(text),
  );
}

/**
 * Words that ask rather than describe: "can you find me", "please look up",
 * "search the internet for". A search index does better without them.
 */
const FILLER = new Set([
  "a",
  "an",
  "the",
  "can",
  "could",
  "would",
  "will",
  "you",
  "please",
  "pls",
  "me",
  "i",
  "i'm",
  "im",
  "find",
  "show",
  "tell",
  "give",
  "look",
  "lookup",
  "up",
  "search",
  "google",
  "check",
  "online",
  "internet",
  "web",
  "want",
  "need",
  "know",
  "let",
  "let's",
  "get",
  "help",
  "hey",
  "hi",
  "q",
  "ok",
  "okay",
  "just",
  "quickly",
  "some",
  "any",
  "anything",
  "everything",
  "out",
  "there",
  "say",
  "says",
  "what's",
  "whats",
]);

/**
 * The person's sentence as a search phrase: their own words, in their
 * order, without the asking. Never adds a word they did not write, and
 * drops figures exactly as composition does.
 */
export function searchPhrase(text: string): string {
  const kept = tokenise(text).filter(
    (token) =>
      !FILLER.has(token) && !PRONOUNS.has(token) && !FIGURE_LIKE.test(token),
  );
  // "look it up" names nothing: no phrase rather than a query of glue words.
  if (kept.every((token) => CONNECTIVES.has(token))) return "";
  return kept.join(" ").slice(0, RESEARCH_BOUNDS.maxQueryChars).trim();
}

/** Words that point at something said before; alone they search for nothing. */
const PRONOUNS = new Set([
  "it",
  "them",
  "they",
  "her",
  "him",
  "she",
  "he",
  "this",
  "that",
  "these",
  "those",
  "one",
  "ones",
]);

/**
 * Compose the query that may leave. Preserves the order of the surviving
 * tokens from the requested query; appends the public identity when the
 * requested query does not already name the subject, so the provider
 * searches the right thing.
 */
export function composeEgressQuery(input: EgressInput): EgressOutcome {
  const allowed = allowedSet(input);
  const identityTokens = new Set(
    [...input.publicIdentity, ...(input.shownNames ?? [])].flatMap((term) =>
      tokenise(term),
    ),
  );
  const requested = tokenise(input.requestedQuery);
  const survivors: string[] = [];
  let dropped = 0;
  for (const token of requested) {
    if (
      allowed.has(token) &&
      !identityTokens.has(token) &&
      FIGURE_LIKE.test(token) &&
      // A year dates a research question ("water access 2025"); it is
      // never a private figure.
      !(input.researchVocabulary === true && YEAR.test(token))
    ) {
      // A figure the person typed is still not something to search the web for.
      dropped += 1;
      continue;
    }
    if (allowed.has(token)) {
      survivors.push(token);
    } else {
      dropped += 1;
    }
  }
  const namesSubject =
    input.publicIdentity.length === 0 ||
    input.publicIdentity.some((term) =>
      tokenise(term).every((token) => survivors.includes(token)),
    );
  const variants = variantsFor(input);
  const userTokens = new Set(personTokens(input).flatMap(variants));
  const pageTokens = new Set(publicTokens(input).flatMap(variants));
  const informative = survivors.filter(
    (token) =>
      userTokens.has(token) ||
      identityTokens.has(token) ||
      (pageTokens.has(token) && !CONNECTIVES.has(token)),
  );
  let parts: string[];
  let fellBackToIdentity = false;
  if (informative.length === 0) {
    if (input.publicIdentity.length === 0) {
      return {
        ok: false,
        reason: "NOTHING_SAFE_TO_SEND",
        droppedTokens: dropped,
      };
    }
    parts = [...input.publicIdentity];
    fellBackToIdentity = true;
  } else {
    parts =
      namesSubject || input.prependIdentity === false
        ? survivors
        : [
            ...(input.publicIdentity[0] === undefined
              ? []
              : [input.publicIdentity[0]]),
            ...survivors,
          ];
  }
  const query = parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, RESEARCH_BOUNDS.maxQueryChars);
  return { ok: true, query, droppedTokens: dropped, fellBackToIdentity };
}

/**
 * True when `text` contains any of the given private values, ignoring case
 * and surrounding whitespace. Used by the hard tests (§10) and as a final
 * guard before egress when a caller knows specific values that must never
 * leave.
 */
export function containsAny(text: string, values: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return values.some((value) => {
    const needle = value.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}
