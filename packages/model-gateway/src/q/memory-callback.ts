/**
 * HQ-7 (conversation audit slice 7): one memory callback at most per
 * answer, only when it bears on this turn, and never word for word.
 *
 * The candidates come from recall already scoped to this person, tenant
 * and run (q-knowledge callbacks.ts): what they themselves said. Code picks
 * the one that shares the most meaningful words with what they just said
 * (none shared: no callback), offers it to the answer as an optional note,
 * and drops any sentence of the answer that copies 8 or more consecutive
 * words of what they said: a callback is a paraphrase, never a quote.
 */
export type QMemoryCallbackCandidate = {
  readonly memoryType: "fact" | "preference" | "correction";
  readonly content: string;
  readonly quote: string | null;
};

/** Consecutive words in common that make a callback a quote. */
export const CALLBACK_VERBATIM_WORDS = 8;

const STOP = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "just",
  "like",
  "more",
  "most",
  "not",
  "now",
  "only",
  "other",
  "our",
  "out",
  "over",
  "really",
  "should",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "very",
  "want",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word.length > 0);

const meaningful = (text: string): ReadonlySet<string> =>
  new Set(words(text).filter((word) => word.length >= 4 && !STOP.has(word)));

/** The one candidate this turn bears on, or null. */
export function memoryCallbackFor(
  candidates: readonly QMemoryCallbackCandidate[],
  utterance: string,
): QMemoryCallbackCandidate | null {
  const asked = meaningful(utterance);
  if (asked.size === 0) return null;
  let best: QMemoryCallbackCandidate | null = null;
  let bestShared = 0;
  for (const candidate of candidates) {
    const shared = [...meaningful(candidate.content)].filter((word) =>
      asked.has(word),
    ).length;
    if (shared > bestShared) {
      best = candidate;
      bestShared = shared;
    }
  }
  return best;
}

/** The answer's turn note for it (trusted, code's; optional to use). */
export function memoryCallbackNote(
  candidate: QMemoryCallbackCandidate,
): string {
  const what = candidate.content.replace(/"/gu, "'");
  return `CALLBACK (optional, at most once): if it genuinely helps this answer, you may refer back in one short clause, in your own words, to something they told you earlier: "${what}". Paraphrase it (never quote their words), say it as something they told you (not as verified), and leave it out if it does not fit.`;
}

/** Whether `sentence` copies CALLBACK_VERBATIM_WORDS words in a row of `source`. */
export function copiesWords(
  sentence: string,
  source: string,
  run: number = CALLBACK_VERBATIM_WORDS,
): boolean {
  const said = words(sentence);
  const from = words(source);
  if (said.length < run || from.length < run) return false;
  const grams = new Set<string>();
  for (let at = 0; at + run <= from.length; at += 1) {
    grams.add(from.slice(at, at + run).join(" "));
  }
  for (let at = 0; at + run <= said.length; at += 1) {
    if (grams.has(said.slice(at, at + run).join(" "))) return true;
  }
  return false;
}

/** A sentence that quotes the callback's words is not said. */
export function quotesCallback(
  sentence: string,
  candidate: QMemoryCallbackCandidate | null,
): boolean {
  if (candidate === null) return false;
  return (
    copiesWords(sentence, candidate.content) ||
    (candidate.quote !== null && copiesWords(sentence, candidate.quote))
  );
}

/** The answer without any sentence that quotes the callback's words. */
export function withoutQuotedCallback(
  text: string,
  candidate: QMemoryCallbackCandidate | null,
): string {
  if (candidate === null) return text;
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/gu) ?? [text];
  const kept = sentences.filter(
    (sentence) => !quotesCallback(sentence, candidate),
  );
  return kept.length === sentences.length ? text : kept.join("").trim();
}
