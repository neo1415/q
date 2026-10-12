/**
 * The words of a question that may name what an earlier conversation was
 * about, chosen by code, never by a model: a name the person typed with a
 * capital ("Tensorgate", "Lagos") is the cheapest reliable signal of a
 * subject, and a conversation started from Home carries no subject ref to
 * find it by. Common capitalised words (mostly sentence openers) are not
 * names and would match nearly every summary, so they are dropped.
 */

export const RECALL_TERMS_MAX = 8;
const TERM_MIN = 4;
const TERM_MAX = 60;

const COMMON = new Set([
  "about",
  "after",
  "again",
  "also",
  "anything",
  "before",
  "could",
  "does",
  "doing",
  "earlier",
  "ever",
  "from",
  "give",
  "going",
  "have",
  "hello",
  "here",
  "into",
  "just",
  "know",
  "last",
  "like",
  "look",
  "make",
  "maybe",
  "more",
  "much",
  "please",
  "recall",
  "remember",
  "show",
  "since",
  "some",
  "still",
  "tell",
  "thank",
  "thanks",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "today",
  "what",
  "whats",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "yesterday",
  "your",
]);

/** Leading and trailing punctuation, and a trailing possessive. */
function bare(token: string): string {
  return token
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .replace(/['’]s$/u, "");
}

export function recallTermsFrom(utterance: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of utterance.split(/\s+/u)) {
    const token = bare(raw);
    if (token.length < TERM_MIN || token.length > TERM_MAX) continue;
    if (!/^\p{Lu}/u.test(token)) continue;
    const key = token.toLowerCase();
    if (COMMON.has(key.replace(/['’]/gu, "")) || seen.has(key)) continue;
    seen.add(key);
    terms.push(token);
    if (terms.length === RECALL_TERMS_MAX) break;
  }
  return terms;
}
