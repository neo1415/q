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

/**
 * One closed question about their reply, read by meaning (the gateway's
 * UTTERANCE_CHECK reader): YES, NO or UNSURE; null when it could not be
 * read. Composed in main.ts; absent only in tests of other properties.
 */
export type ReadBackCheck = (input: {
  /** Q's line they are answering. Trusted: Capital Q's own words. */
  readonly readBack: string;
  /** What they said back. Untrusted. */
  readonly reply: string;
}) => Promise<"YES" | "NO" | "UNSURE" | null>;

/** The closed question, Q's line bounded to fit the reader's question. */
export function readBackQuestion(readBack: string): string {
  const line = readBack.trim().replace(/\s+/gu, " ");
  const quoted = line.length <= 420 ? line : `${line.slice(0, 417)}...`;
  return `Q just said to them: "${quoted}". Does their reply agree to what Q said, as Q said it, without changing it, adding to it, doubting it or asking about it?`;
}

/**
 * Their reply to a read-back (P1-2, onboarding plan 2026-11-07; DECISIONS
 * 40: read by meaning, never by a word list). YES is AFFIRM, NO is
 * CORRECT; unsure, unread, or nothing to read is UNCLEAR, which agrees to
 * nothing (fail closed).
 */
export async function readBackReplyBy(
  check: ReadBackCheck | undefined,
  readBack: string | undefined,
  reply: string,
): Promise<ReadBackReply> {
  if (check === undefined || readBack === undefined) return "UNCLEAR";
  if (reply.trim().length === 0 || readBack.trim().length === 0) {
    return "UNCLEAR";
  }
  const answer = await check({ readBack, reply }).catch(() => null);
  return answer === "YES" ? "AFFIRM" : answer === "NO" ? "CORRECT" : "UNCLEAR";
}
