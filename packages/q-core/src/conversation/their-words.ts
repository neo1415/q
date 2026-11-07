/**
 * Whether a value said to be "the person's own words, filler removed" is
 * structurally that (onboarding P1-1, DECISIONS 77). The reader decides by
 * meaning whether an answer is clear (kept in their words) or rambling
 * (Q's summary, said back for their yes); this only checks the claim, so
 * nothing Q reworded is saved as theirs without their yes. Structure only,
 * never a word list of meanings (DECISIONS 40): which words are filler is
 * the reader's call; that it only removed words, and not too many, is code's.
 *
 * Their words cleaned means:
 * - every token of the value, in order, is a token of their line
 *   (deletions only: nothing added, reworded or reordered); and
 * - it keeps at least THEIR_WORDS_MIN_KEPT of their line's tokens.
 */

/**
 * The share of their line's tokens a cleaned answer keeps, at least.
 * Filler in a clear answer (um, uh, like, you know, I mean, a false start,
 * a word said twice) is rarely more than a fifth of what was said; 0.7
 * leaves room for a clear spoken answer with a few false starts. Cutting
 * more than that is a selection, not a cleaning: deletions alone can drop
 * a "not" or a qualifier and change the meaning, so a large cut is said
 * back for their yes instead. The safe direction is always the read-back.
 */
export const THEIR_WORDS_MIN_KEPT = 0.7;

/** Lower-cased letters and digits in any script; punctuation splits. */
export function wordTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’'`]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** Whether `part`'s tokens occur in `whole`'s, in order (gaps allowed). */
export function isTokenSubsequence(
  part: readonly string[],
  whole: readonly string[],
): boolean {
  let at = 0;
  for (const token of whole) {
    if (at < part.length && part[at] === token) at += 1;
  }
  return at === part.length;
}

export type TheirWordsCheck = {
  /** Deletions only from their line. */
  readonly deletionsOnly: boolean;
  /** Share of their line's tokens kept (0 when the line is empty). */
  readonly kept: number;
  /** Both hold: the value is their words with filler removed. */
  readonly cleaned: boolean;
};

/** The check, with its parts (for evals and logs). */
export function checkTheirWords(value: string, line: string): TheirWordsCheck {
  const theirs = wordTokens(line);
  const given = wordTokens(value);
  const deletionsOnly = given.length > 0 && isTokenSubsequence(given, theirs);
  const kept = theirs.length === 0 ? 0 : given.length / theirs.length;
  return {
    deletionsOnly,
    kept,
    cleaned: deletionsOnly && kept >= THEIR_WORDS_MIN_KEPT,
  };
}

/** Whether `value` is `line` in their own words with only filler removed. */
export function cleanedFromTheirLine(value: string, line: string): boolean {
  return checkTheirWords(value, line).cleaned;
}
