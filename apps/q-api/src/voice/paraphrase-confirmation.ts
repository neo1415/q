/**
 * A free-text answer in Q's words, saved only once the person confirmed
 * those words (owner live 2026-10-17, "NEM Insurance").
 *
 * P0-2 kept a model from writing facts nobody said by refusing any free
 * text that was not the person's own words. On a rambling spoken answer
 * that refused every clean summary, and Q told the founder it "couldn't
 * save that because it isn't your exact words" until they gave up. The
 * safety intent stays, enforced differently: Q's summary of a narrative
 * answer is held as a pending Q recommendation (durable, its payload
 * immutable), read back to them, and written only when their next words
 * affirm what they just heard. A summary they never heard or never
 * agreed to is never on the record.
 *
 * Structural checks only: whether Q's last turn carried the summary's
 * words, and whether their reply is a plain yes, a correction or neither.
 * The independent turn reader still decides approval in every language;
 * this is the narrow English case code can decide without a model.
 */

/**
 * Marks a held recommendation as Q's summary of the person's words. Shown
 * to them as it is, so it speaks to them (QA F-53, 23 Oct 2026: "from what
 * they said earlier" read in the third person on their own screen).
 */
export const PARAPHRASE_RATIONALE_PREFIX = "Q's summary of your words";
/** The wording held recommendations were stored with before F-53. */
const EARLIER_PARAPHRASE_PREFIX = "Q's summary of their words";

/** The rationale kept with a held summary: their original words, as said. */
export function paraphraseRationale(quote: string): string {
  return `${PARAPHRASE_RATIONALE_PREFIX}: "${quote.trim().slice(0, 240)}"`;
}

export function isParaphraseRationale(rationale: string | null): boolean {
  return (
    rationale?.startsWith(PARAPHRASE_RATIONALE_PREFIX) === true ||
    rationale?.startsWith(EARLIER_PARAPHRASE_PREFIX) === true
  );
}

function tokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’']/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Words a read-back may change without changing what it says: "we are"
 * read back as "you are" or "NEM Insurance is". Never a negation, a
 * figure or a word that carries the claim.
 */
const FRAMING = new Set([
  "a",
  "an",
  "the",
  "so",
  "is",
  "are",
  "am",
  "we",
  "us",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "they",
  "their",
  "it",
  "its",
  "i",
  "my",
  "were",
  "youre",
  "theyre",
]);

/**
 * Whether Q's last turn said the summary back: every word of it that
 * carries meaning is in what Q said. A summary Q never said to them cannot
 * be what they agreed to.
 */
export function heardBack(text: string, qTurn: string | undefined): boolean {
  if (qTurn === undefined) return false;
  const said = new Set(tokens(qTurn));
  const carried = tokens(text).filter((t) => !FRAMING.has(t));
  return carried.length > 0 && carried.every((t) => said.has(t));
}

export type ReadBackReply = "AFFIRM" | "CORRECT" | "UNCLEAR";

/** "Go ahead and paraphrase it", "save it", "I give you permission". */
const PERMISSION =
  /\b(?:go ahead|save (?:it|that|this|what you)|paraphrase (?:it|that)|(?:give|gave|giving) you (?:my )?permission|you have my permission|(?:use|keep) (?:that|it|yours|your (?:version|wording|summary))|put (?:it|that) down|write (?:it|that) down)\b/u;
/** A permission taken back in the same breath. */
const WITHHELD =
  /\b(?:dont|do not|not yet|wait|hold on|hang on|before you|instead)\b/u;
/** A plain yes, at the start of what they said. */
const YES =
  /^(?:(?:um+|uh+|oh|ah|well|so|and)\s+)*(?:yes|yeah|yea|yep|yup|ya|yah|sure|correct|right|exactly|perfect|absolutely|definitely|precisely|indeed|ok|okay|great|good|fine|spot on|sounds (?:good|right|great|fine)|thats (?:it|right|correct|perfect|good|fine|great|accurate)|that is (?:it|right|correct|accurate)|you got it|nailed it|please do|do it|go for it|uh huh|mm hmm)\b/u;
/** Anything that changes, adds to or doubts what was read back. */
const CHANGING =
  /\b(?:no|nope|not|isnt|wasnt|arent|dont|doesnt|didnt|wrong|incorrect|actually|but|except|instead|rather|change|fix|missing|forgot|also|plus|though|however|wait)\b/u;

/**
 * Their reply to a read-back: a plain yes or a permission to save what Q
 * offered is AFFIRM; a no, a change or an addition is CORRECT; a question
 * or anything longer is UNCLEAR and left to the reader.
 */
export function readBackReplyOf(utterance: string): ReadBackReply {
  const raw = utterance.trim();
  if (raw.length === 0) return "UNCLEAR";
  const said = raw
    .toLocaleLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}?\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (PERMISSION.test(said) && !WITHHELD.test(said) && !said.includes("?")) {
    return "AFFIRM";
  }
  if (CHANGING.test(said)) return "CORRECT";
  if (said.includes("?")) return "UNCLEAR";
  const words = said.split(" ").length;
  return YES.test(said) && words <= 12 ? "AFFIRM" : "UNCLEAR";
}
