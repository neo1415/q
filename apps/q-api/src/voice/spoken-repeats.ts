/**
 * Owner 18 Nov 2026 ("I hope it's not repeating stuff like a robot"):
 * code-written stock lines -- a tie line, "That's how well they match your
 * mandate, not a judgement of quality.", "This is missing information, not
 * a negative finding.", "Want me to go deeper?" -- were said again in one
 * answer and again on the next. Production, 11-18 Nov: 9 sentences said
 * twice inside one live answer, and 12 of 201 answers repeating a sentence
 * of the answer just before.
 *
 * What is dropped is only ever a stock line: a sentence of four words or
 * more with no figure in it, said already in this answer or in one of the
 * last few answers on the line. A sentence with a figure is content (it
 * may be the answer to a repeated question) and stays. Dropping a sentence
 * never adds a word, so it cannot say anything the answer's guards and the
 * claim check did not pass; the screen keeps the whole answer. An answer
 * made only of repeats is said whole: they asked again.
 *
 * Pure: no model, no I/O.
 */

/** How many earlier answers on a line a stock line is not said again after. */
export const SPOKEN_REPEAT_WINDOW = 4;

/** A sentence ends at its punctuation and a space: "9.1" is one figure. */
const SENTENCE_END = /(?<=[.!?…]["'”’)]*)\s+/u;
const OPENER = /^(?:so|and|but|also|again|okay|ok|right|well)\b\s*/u;

/** A sentence as compared: case, punctuation and an opening filler aside. */
export function sentenceKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[‘’']/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(OPENER, "")
    .trim();
}

function sentencesOf(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A line code or Q says the same way each time: no figure, a real sentence. */
function stockLine(sentence: string, key: string): boolean {
  return !/\p{N}/u.test(sentence) && key.split(" ").length >= 4;
}

/**
 * `words` without the stock lines already said in it or in `before` (the
 * line's recent answers, oldest first). `keep` is never dropped (code's
 * approval question binds the next "yes").
 */
export function withoutRepeatedLines(
  words: string,
  before: readonly string[],
  keep: readonly string[] = [],
): { readonly text: string; readonly removed: number } {
  const earlier = new Set<string>();
  for (const answer of before.slice(-SPOKEN_REPEAT_WINDOW)) {
    for (const sentence of sentencesOf(answer)) {
      earlier.add(sentenceKey(sentence));
    }
  }
  const kept = new Set(keep.map(sentenceKey));
  const seen = new Set<string>();
  const out: string[] = [];
  let removed = 0;
  const all = sentencesOf(words);
  for (const sentence of all) {
    const key = sentenceKey(sentence);
    if (
      key.length > 0 &&
      !kept.has(key) &&
      stockLine(sentence, key) &&
      (seen.has(key) || earlier.has(key))
    ) {
      removed += 1;
      continue;
    }
    seen.add(key);
    out.push(sentence);
  }
  if (removed === 0) return { text: words, removed: 0 };
  // Nothing new at all: they asked again, and it is said again.
  if (out.length === 0) return { text: words, removed: 0 };
  return { text: out.join(" "), removed };
}
