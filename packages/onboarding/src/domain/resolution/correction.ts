/**
 * "No, that's wrong." · "What I meant was Series A." · "Actually, we're
 * enterprise software, not logistics infrastructure." (CQ-Q-VOICE-001 A §14).
 *
 * A correction is a conversational move the interview owns: the words
 * after the correction phrase are read again, against the step the person
 * most recently answered (or the one Q is asking, when nothing was answered
 * yet), and land through the same supersede path every revision uses —
 * history is kept, nothing is overwritten invisibly. A bare "no, that's
 * wrong" with nothing after it asks the person what should change.
 */

const CORRECTION =
  /^(?:no[,.!]?\s+)?(?:(?:that'?s|that is|this is|it'?s|it is)\s+(?:wrong|not right|incorrect|not it|not what i (?:meant|said))|actually|correction|i meant|what i meant (?:was|is)|i mean|sorry|scratch that|let me correct that|change that)[,.:!\s-]*(.*)$/i;

export type CorrectionIntent = {
  /** The words that carry the corrected answer; empty when only the objection was said. */
  readonly remainder: string;
};

export function correctionIntent(text: string): CorrectionIntent | null {
  const match = CORRECTION.exec(text.trim());
  if (match === null) {
    return null;
  }
  const remainder = (match[1] ?? "")
    .replace(/^(?:it'?s|it is|we'?re|we are|i'?m|i am)\s+/i, "")
    .trim();
  // "Sorry, I meant Ghana": one correction phrase may introduce another.
  const nested = remainder.length > 0 ? correctionIntent(remainder) : null;
  return nested ?? { remainder };
}
