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
  "overview",
  "history",
  "2024",
  "2025",
  "2026",
  "africa",
  "african",
]);

/** A figure or money-like token: "2.4m", "$700k", "3,000,000", "USD". */
const FIGURE_LIKE =
  /^(?:[$£€]|usd|gbp|eur|ngn|kes|zar)?\d[\d.,]*(?:k|m|mn|bn|b|%)?$/i;

export function tokenise(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_$£€.'&-]+/gu, " ")
    .split(" ")
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((token) => token.length > 0);
}

function allowedSet(input: EgressInput): ReadonlySet<string> {
  const allowed = new Set<string>(CONNECTIVES);
  for (const token of tokenise(input.userText)) {
    if (!FIGURE_LIKE.test(token)) {
      allowed.add(token);
    }
  }
  for (const term of input.publicIdentity) {
    for (const token of tokenise(term)) {
      allowed.add(token);
    }
  }
  return allowed;
}

/**
 * Compose the query that may leave. Preserves the order of the surviving
 * tokens from the requested query; appends the public identity when the
 * requested query does not already name the subject, so the provider
 * searches the right thing.
 */
export function composeEgressQuery(input: EgressInput): EgressOutcome {
  const allowed = allowedSet(input);
  const identityTokens = new Set(
    input.publicIdentity.flatMap((term) => tokenise(term)),
  );
  const requested = tokenise(input.requestedQuery);
  const survivors: string[] = [];
  let dropped = 0;
  for (const token of requested) {
    if (
      allowed.has(token) &&
      !identityTokens.has(token) &&
      FIGURE_LIKE.test(token)
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
  const userTokens = new Set(tokenise(input.userText));
  const informative = survivors.filter(
    (token) => userTokens.has(token) || identityTokens.has(token),
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
