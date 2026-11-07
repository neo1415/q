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
 * - it keeps at least THEIR_WORDS_MIN_KEPT of their line's tokens, or it
 *   is the rest of their line, whole, after a short lead-in of at most
 *   THEIR_WORDS_MAX_LEAD_IN tokens ("change our description to …").
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

/**
 * A short instruction or lead-in before the answer ("change our
 * description to", "put it as", "the website, then") is not part of it:
 * dropping only that, with every word after it kept whole to the end of
 * their line, is not a selection, however short the line. Five tokens
 * covers such a lead-in; a longer cut, or any cut inside or after the
 * answer, must meet THEIR_WORDS_MIN_KEPT (a ramble's middle never does).
 */
export const THEIR_WORDS_MAX_LEAD_IN = 5;

/**
 * A spoken answer is held to a stricter bar (P1-1 live run 1, 7 Nov 2026:
 * a rambling spoken answer was saved without a read-back; tuned on the dev
 * split only). Speech carries more filler, restarts and wandering than
 * typing, and a summary said back costs the person one "yes", so spoken
 * leans to the read-back:
 * - at most SPOKEN_MAX_WORDS words: a longer spoken answer is always said
 *   back (every clear spoken answer in the dev set is 35 words or fewer;
 *   every rambling one is 42 or more, or a short ramble);
 * - at least SPOKEN_MIN_KEPT of it kept (clear spoken answers, corrections
 *   included, keep 0.846-0.97 in the dev set; a ramble's filler and
 *   restarts take more than that out). The bar is 0.8, below the lowest
 *   clear one (0.846) and above the plain 0.7 a spoken ramble passed.
 */
export const SPOKEN_MAX_WORDS = 40;
export const SPOKEN_MIN_KEPT = 0.8;

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
  /** The value is the rest of their line after a short lead-in. */
  readonly afterLeadIn: boolean;
  /** Deletions only, and enough kept (or only a lead-in dropped). */
  readonly cleaned: boolean;
};

export type TheirWordsOptions = {
  /** The line was spoken: the stricter bar applies. */
  readonly spoken?: boolean | undefined;
};

/** The check, with its parts (for evals and logs). */
export function checkTheirWords(
  value: string,
  line: string,
  options: TheirWordsOptions = {},
): TheirWordsCheck {
  const theirs = wordTokens(line);
  const given = wordTokens(value);
  const deletionsOnly = given.length > 0 && isTokenSubsequence(given, theirs);
  const kept = theirs.length === 0 ? 0 : given.length / theirs.length;
  const leadIn = theirs.length - given.length;
  const afterLeadIn =
    given.length > 0 &&
    leadIn >= 0 &&
    leadIn <= THEIR_WORDS_MAX_LEAD_IN &&
    given.every((token, i) => theirs[leadIn + i] === token);
  const spoken = options.spoken === true;
  const enough = spoken
    ? theirs.length <= SPOKEN_MAX_WORDS &&
      (kept >= SPOKEN_MIN_KEPT || afterLeadIn)
    : kept >= THEIR_WORDS_MIN_KEPT || afterLeadIn;
  return {
    deletionsOnly,
    kept,
    afterLeadIn,
    cleaned: deletionsOnly && enough,
  };
}

/** Whether `value` is `line` in their own words with only filler removed. */
export function cleanedFromTheirLine(
  value: string,
  line: string,
  options: TheirWordsOptions = {},
): boolean {
  return checkTheirWords(value, line, options).cleaned;
}
