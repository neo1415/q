/**
 * Q's prose never claims an action (CQ-QX-007).
 *
 * Capital Q says what it prepared, applied or could not do, from the
 * action record it actually holds. A model writing "I have prepared the
 * update — it's ready for your approval" beside that line is, at best,
 * saying it twice and, at worst, claiming a proposal that does not exist
 * (the walkthrough's F14: no proposal, and the reply said there was one).
 *
 * Which sentences are about acting is meaning, so it is not decided here.
 * The analyst reads it into a closed field, `actionTalk`, word for word
 * (ADR 0011); this removes exactly those sentences from the answer and
 * nothing else — the same verbatim removal the interview uses for the
 * platform's own instruction text. A sentence the model did not name is
 * left alone, and a named sentence that is not in the answer changes
 * nothing, so the worst a wrong reading can do is leave a sentence in.
 */
export type ActionTalkStripResult = {
  readonly text: string;
  readonly removed: number;
};

/** Shorter than this is not a sentence worth matching: "OK." is not a claim. */
const MIN_SENTENCE_CHARS = 8;

export function withoutActionTalk(
  answer: string,
  actionTalk: readonly string[] | undefined,
): ActionTalkStripResult {
  let text = answer;
  let removed = 0;
  const sentences = [...(actionTalk ?? [])]
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS)
    // Longest first, so a sentence that contains a shorter named one is
    // removed whole rather than leaving its remainder behind.
    .sort((a, b) => b.length - a.length);
  for (const sentence of sentences) {
    if (!text.includes(sentence)) continue;
    text = text.split(sentence).join("");
    removed += 1;
  }
  if (removed === 0) {
    return { text: answer, removed };
  }
  // Tidy only what the removal left: doubled spaces, a space before
  // punctuation, blank lines. Paragraphs and list lines are kept.
  const tidy = text
    .split("\n")
    .map((line) =>
      line
        // Residue of a removal at the start of a line; an indented list
        // item starts with its marker and keeps its indent.
        .replace(/^[ \t]+(?=[A-Za-z(])/, "")
        .replace(/(\S)[ \t]{2,}/g, "$1 ")
        .replace(/[ \t]+([.,;:!?])/g, "$1")
        .replace(/^[ \t]*[–—-][ \t]*$/, "")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: tidy, removed };
}
