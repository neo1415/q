/**
 * Whether spoken words can decide the card Q asked about (lead 2026-10-03,
 * after run ad0b0067 on the typed path): only a reply to the card decides
 * it, never a request or a statement, and nothing the line mishears may
 * approve. Speech adds two ways to be wrong that typing does not:
 *
 * - a fragment: the recogniser hands over "go ahead with the" while the
 *   person is still talking, and its words alone read as a plain yes;
 * - an echo: Q's own voice, picked up by the microphone ("Shall I go
 *   ahead?"), comes back as the person's words.
 *
 * Neither is a decision. Both are judged from the words and from what Q
 * said, by code; the meaning (reply or request, yes or no) is read by the
 * turn reader and DECISION_READER, never matched here.
 */

/** Ends mid-phrase: a dangling word, a trailing dash or ellipsis. */
const DANGLING =
  /(?:\b(?:the|a|an|with|and|to|for|of|my|our|your|their|on|in|at|but|so|or|that|this|then|if|because|um|uh|er|erm)\s*[,;:]?|\.\.\.|…|[-–—])\s*$/iu;

export function isFragment(utterance: string): boolean {
  return DANGLING.test(utterance.trim());
}

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Q's own words heard back: three or more words that are part of what Q
 * just said, or Q's question form itself. A person answering does not
 * say "Shall I go ahead?".
 */
export function isEcho(utterance: string, qLines: readonly string[]): boolean {
  const said = words(utterance);
  if (said.length === 0) return false;
  if (/^shall i\b/u.test(said)) return true;
  if (said.split(" ").length < 3) return false;
  return qLines.some((line) => words(line).includes(said));
}
