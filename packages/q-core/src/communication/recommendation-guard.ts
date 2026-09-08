/**
 * The recommendation-explanation guard (CQ-Q-023).
 *
 * Capital Q has no deterministic recommendation factor model. There is no
 * versioned feature snapshot, no ranking configuration, no reason-code
 * catalogue and no slate — Wave 6 owns all of it. Until it exists, the
 * question "why was this recommended to me?" has no true answer, and any
 * sentence that answers it was invented.
 *
 * COMPANY_ANALYST v2 already forbids scores, fit, probabilities and peer
 * benchmarks in plain terms, and CQ-Q-020's finding validation drops
 * findings that assert one. Neither reaches the text a person actually
 * reads: the model's `answer` prose went to the stored Q message with only
 * a length trim. The prompt is not the security boundary — every prompt in
 * this repository says so — and the thing standing between a fluent model
 * and a fabricated "91% fit" reaching an investor cannot be the instruction
 * not to write one.
 *
 * So this sits on the last surface before a person reads the text.
 *
 * It removes the sentence rather than rewriting it. A rewritten explanation
 * is one nobody wrote, and Capital Q would still be the author of a claim it
 * cannot support. Removing is blunt and occasionally costs an honest
 * sentence that happened to be phrased as a recommendation; that is the
 * right trade while the alternative is publishing an invented reason.
 *
 * When the factor model lands, this is not deleted. It becomes the check
 * that an explanation cites factors the ranker actually produced.
 */

/** What Capital Q says instead. Plain, and free of implementation words (§17). */
export const RECOMMENDATION_UNAVAILABLE_MESSAGE =
  "I can't explain how you'd be recommended to an investor yet — Capital Q doesn't match companies and investors at this stage. I can tell you what the evidence says about the business, and what an investor's stated mandate covers, but that isn't the same thing.";

/**
 * Sentences asserting a recommendation, a ranking or a fit that no
 * deterministic layer produced.
 *
 * Three families, and each is here because it makes a claim about a
 * comparison Capital Q has not performed:
 *
 *   - a fit or match expressed as a quantity;
 *   - a statement about why something was shown, surfaced or recommended;
 *   - a position in an ordering.
 *
 * Deliberately not a ban on the words themselves. "Your mandate covers Seed
 * and Series A" contains no claim about a comparison; "this is a 91% fit"
 * does. The patterns target the assertion, not the vocabulary, because a
 * filter on vocabulary would delete honest answers about a company's sector
 * or an investor's own stated criteria.
 */
const RECOMMENDATION_CLAIM_PATTERNS: readonly RegExp[] = [
  // A fit or match as a quantity, in any of the ways a model writes one.
  /\b\d{1,3}\s*%\s*(?:fit|match|aligned|alignment)\b/i,
  /\b(?:fit|match|alignment)\s*(?:score|rating)\b/i,
  /\b(?:fit|match)\s*(?:score|rating)?\s*(?:of|:)\s*\d/i,
  /\b\d{1,2}(?:\.\d)?\s*(?:\/|out of)\s*10\b/i,
  /\b(?:strong|excellent|poor|weak|high|low)\s+(?:fit|match)\b/i,
  // The same claim with the noun first: "investor fit is strong".
  /\b(?:fit|match|alignment)\s+(?:is|looks|seems)\s+(?:strong|excellent|poor|weak|high|low|good|bad)\b/i,
  /\bfits?\s+your\s+mandate\s+(?:well|strongly|closely|perfectly)\b/i,

  // Why this was shown. The claim that a recommendation happened at all.
  /\b(?:recommended|surfaced|shown|suggested|matched)\s+(?:to|for)\s+you\b/i,
  /\bcapital\s*q\s+(?:recommended|surfaced|suggested|matched|selected|chose)\b/i,
  /\bwhy\s+(?:we|capital\s*q|q)\s+(?:matched|recommended|surfaced|showed)\b/i,
  /\b(?:you\s+were|this\s+(?:was|company\s+was))\s+(?:recommended|surfaced|shown|suggested|matched)\b/i,
  /\b(?:appears|appeared)\s+in\s+your\s+(?:feed|recommendations)\b/i,

  // A position in an ordering nobody computed.
  /\branked?\s+(?:#\s*)?(?:\d+|first|second|third|top|above|below|higher|lower)\b/i,
  /\b(?:you|this|the company)\s+ranks?\s+(?:highly|well|above|below|first|\d)/i,
  /\b(?:top|bottom)\s+\d{1,2}\s*%/i,
  /\b(?:top|bottom)\s+\d{1,2}\s*(?:companies|matches|company|match)\b/i,
];

/** Whether one sentence asserts a recommendation Capital Q has not made. */
export function claimsRecommendationExplanation(sentence: string): boolean {
  return RECOMMENDATION_CLAIM_PATTERNS.some((pattern) =>
    pattern.test(sentence),
  );
}

/**
 * Split on sentence boundaries, keeping the terminator.
 *
 * Naive by design: a sentence splitter good enough to be interesting is a
 * sentence splitter with edge cases, and the failure mode here should be
 * removing slightly too much rather than slightly too little.
 */
function sentences(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
}

export type GuardedAnswer = {
  /** What a person reads. Never a rewritten claim. */
  readonly text: string;
  /** How many sentences were removed. Reported, never silent. */
  readonly removed: number;
};

/**
 * Strip any recommendation claim from an answer before it is stored.
 *
 * If nothing honest survives, the plain message replaces it: a model that
 * answered only with invented reasons leaves Capital Q with nothing to say,
 * and saying that is better than silence or a trimmed fragment.
 */
export function withoutRecommendationClaims(answer: string): GuardedAnswer {
  const parts = sentences(answer);
  const kept = parts.filter((part) => !claimsRecommendationExplanation(part));
  const removed = parts.length - kept.length;
  if (removed === 0) {
    return { text: answer, removed: 0 };
  }
  const text = kept.join(" ").trim();
  return {
    text: text.length === 0 ? RECOMMENDATION_UNAVAILABLE_MESSAGE : text,
    removed,
  };
}
