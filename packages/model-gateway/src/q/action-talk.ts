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

/**
 * Sentences that restate a change the person asked for (CQ-QX-007 A5).
 *
 * When the analyst read a change request — a new website, a new name —
 * the value it read is in a closed schema field. A sentence of the model's
 * that carries that value is the model talking about the change, and what
 * happened to the change is Capital Q's to say, from the proposal it
 * created or the refusal it got. Matched on the value the structured
 * reading holds, never on words: "noted", "updated" and "will change" are
 * all the same sentence to this, and so is one no list would anticipate.
 */
// A full stop inside "kivu-freight.africa" does not end a sentence: only
// punctuation followed by whitespace or the end of the line does.
const SENTENCE = /[^\n]+?(?:[.!?]+(?=\s|$)|$)/g;
/** Shorter than this, a value is not distinctive enough to anchor on. */
const MIN_VALUE_CHARS = 4;

function withoutSentencesCarrying(
  text: string,
  values: readonly string[],
): { readonly text: string; readonly removed: number } {
  // A value is stored in its field's own form ("https://x.africa/"); a
  // sentence says it as people do ("x.africa"). Both forms anchor.
  const anchors = values
    .map((value) => value.trim().toLowerCase())
    .flatMap((value) => [
      value,
      value
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, ""),
    ])
    .filter((value) => value.length >= MIN_VALUE_CHARS);
  if (anchors.length === 0) return { text, removed: 0 };
  let removed = 0;
  const kept = text
    .split("\n")
    .map((line) =>
      line.replace(SENTENCE, (sentence) => {
        const lower = sentence.toLowerCase();
        if (anchors.some((anchor) => lower.includes(anchor))) {
          removed += 1;
          return "";
        }
        return sentence;
      }),
    )
    .join("\n");
  return { text: kept, removed };
}

export function withoutActionTalk(
  answer: string,
  actionTalk: readonly string[] | undefined,
  /** The values of the changes the structured reading carried. */
  requestedValues: readonly string[] = [],
): ActionTalkStripResult {
  const carrying = withoutSentencesCarrying(answer, requestedValues);
  let text = carrying.text;
  let removed = carrying.removed;
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

/**
 * When Capital Q says a change's status from the engine (proposalStatusLine),
 * the model's own status sentences go, and so does its offer, which moves
 * after the status line (QA run 5fd903d3: "Nothing is waiting for your
 * approval…" beside the model's "The change still needs your approval
 * before it is saved. Want me to update the Q Card now?"). Matched on the
 * status words a sentence uses, never on what the change was: whatever the
 * model said about approval is replaced by the engine's record of it.
 */
const STATUS_TALK =
  /\b(?:approv\w*|pending|waiting for (?:you|your)|saved yet|not (?:been )?saved|(?:is|was|has been|have been) (?:saved|applied|updated|changed|done)|needs? your (?:ok|okay|yes|go-ahead|confirmation|sign-off))\b/iu;
const OFFER =
  /^(?:(?:do you )?want me to|shall i|should i|would you like me to|can i)\b[^?]*\?$/iu;

export type StatusTalkResult = {
  readonly text: string;
  readonly removed: number;
  /** The model's one offer to do it, said after the status line; or null. */
  readonly offer: string | null;
};

export function withoutStatusTalk(answer: string): StatusTalkResult {
  let removed = 0;
  let offer: string | null = null;
  const kept = answer
    .split("\n")
    .map((line) =>
      line.replace(SENTENCE, (sentence) => {
        const trimmed = sentence.trim();
        if (OFFER.test(trimmed)) {
          offer ??= trimmed;
          removed += 1;
          return "";
        }
        if (STATUS_TALK.test(trimmed)) {
          removed += 1;
          return "";
        }
        return sentence;
      }),
    )
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return removed === 0
    ? { text: answer, removed, offer: null }
    : { text: kept, removed, offer };
}
