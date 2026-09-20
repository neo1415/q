/**
 * The recommendation-explanation guard (CQ-Q-023, reconciled in
 * CQ-REC-007R B).
 *
 * When this was written Capital Q had no deterministic recommendation
 * factor model, so the question "why was this recommended to me?" had no
 * true answer and every sentence answering it was invented. Wave 6 built
 * the missing half: a versioned feature snapshot, a versioned ranking
 * config, a reason-code catalogue and a slate, and REC-007 B replays
 * exactly those to say which criteria matched, which did not, and which
 * could not be established.
 *
 * So the guard does what its last paragraph always said it would: it is
 * now the check that an explanation cites factors the ranker actually
 * produced. Given those factors it permits the explanation; given none it
 * behaves exactly as before, which is the behaviour of every caller that
 * has not been handed any — the company specialist, a turn where the
 * recommendation tool was never called, a deployment with no slates.
 *
 * What the factors never license is arithmetic. REC-005 produces no
 * percentage, no score a person may see, no position in a distribution,
 * and the explanation contract carries none, so those families stay
 * forbidden whatever the ranker returned (doc 19 §56). Being able to
 * explain a recommendation is not permission to quantify it.
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
 *
 * These are the ones no factor can ever support: a quantity, a position in
 * an ordering, a place in a distribution. Nothing the ranker returns is any
 * of those, so grounds do not unlock them.
 */
const UNGROUNDABLE_CLAIM_PATTERNS: readonly RegExp[] = [
  // A fit or match as a quantity, in any of the ways a model writes one.
  /\b\d{1,3}\s*%\s*(?:fit|match|aligned|alignment)\b/i,
  /\b(?:fit|match|alignment)\s*(?:score|rating)\b/i,
  /\b(?:fit|match)\s*(?:score|rating)?\s*(?:of|:)\s*\d/i,
  /\b\d{1,2}(?:\.\d)?\s*(?:\/|out of)\s*10\b/i,
  /\b(?:strong|excellent|poor|weak|high|low)\s+(?:fit|match)\b/i,
  // The same claim with the noun first: "investor fit is strong".
  /\b(?:fit|match|alignment)\s+(?:is|looks|seems)\s+(?:strong|excellent|poor|weak|high|low|good|bad)\b/i,
  /\bfits?\s+your\s+mandate\s+(?:well|strongly|closely|perfectly)\b/i,

  // A position in an ordering nobody computed.
  /\branked?\s+(?:#\s*)?(?:\d+|first|second|third|top|above|below|higher|lower)\b/i,
  /\b(?:you|this|the company)\s+ranks?\s+(?:highly|well|above|below|first|\d)/i,
  /\b(?:top|bottom)\s+\d{1,2}\s*%/i,
  /\b(?:top|bottom)\s+\d{1,2}\s*(?:companies|matches|company|match)\b/i,

  // A place in a distribution nobody measured. The analyst charter names
  // two of these outright, "do not say a company is above average or
  // top-decile", and there was no pattern for either: the one sentence the
  // prompt forbids by name was the one that got through.
  /\b(?:top|bottom|upper|lower)[\s-](?:decile|quartile|quintile|third|half)\b/i,
  /\b(?:above|below)\s+(?:the\s+)?(?:average|median|par)\b/i,
  /\bbest[\s-]in[\s-]class\b/i,
  /\b(?:out|under)performs?\s+(?:its|their|the)\s+(?:peers|peer group|category|sector)\b/i,
  /\b(?:compares?|compared)\s+(?:favourably|favorably|poorly)\b/i,
];

/**
 * The claim that a recommendation happened at all.
 *
 * This family, and only this family, is what the factor model answers. A
 * turn holding real factors may say a company was surfaced and why; a turn
 * holding none may not, because then nobody decided it.
 */
const SHOWN_TO_YOU_PATTERNS: readonly RegExp[] = [
  /\b(?:recommended|surfaced|shown|suggested|matched)\s+(?:to|for)\s+you\b/i,
  /\bcapital\s*q\s+(?:recommended|surfaced|suggested|matched|selected|chose)\b/i,
  /\bwhy\s+(?:we|capital\s*q|q)\s+(?:matched|recommended|surfaced|showed)\b/i,
  /\b(?:you\s+were|this\s+(?:was|company\s+was))\s+(?:recommended|surfaced|shown|suggested|matched)\b/i,
  /\b(?:appears|appeared)\s+in\s+your\s+(?:feed|recommendations)\b/i,
];

/**
 * What the ranking engine actually produced for this turn.
 *
 * Only the dimensions it scored, named as REC-007 B names them. Not the
 * prose, and deliberately not the scores: this decides whether Capital Q
 * is entitled to say a recommendation happened, not what it may say about
 * how strong one is.
 */
export type RecommendationGrounds = {
  readonly dimensions: readonly string[];
};

function grounded(grounds: RecommendationGrounds | null | undefined): boolean {
  return (
    grounds !== null && grounds !== undefined && grounds.dimensions.length > 0
  );
}

/**
 * Whether one sentence asserts a recommendation Capital Q cannot support.
 *
 * Without grounds that is any of the four families, as before. With them,
 * explaining that something was surfaced is a supported claim -- the
 * ranker did surface it, and said why -- while quantities, orderings and
 * distributions remain unsupported, because no factor produces one.
 */
export function claimsRecommendationExplanation(
  sentence: string,
  grounds?: RecommendationGrounds | null,
): boolean {
  if (UNGROUNDABLE_CLAIM_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return true;
  }
  if (grounded(grounds)) {
    return false;
  }
  return SHOWN_TO_YOU_PATTERNS.some((pattern) => pattern.test(sentence));
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
export function withoutRecommendationClaims(
  answer: string,
  grounds?: RecommendationGrounds | null,
): GuardedAnswer {
  const parts = sentences(answer);
  const kept = parts.filter(
    (part) => !claimsRecommendationExplanation(part, grounds),
  );
  const removed = parts.length - kept.length;
  if (removed === 0) {
    return { text: answer, removed: 0 };
  }
  const text = kept.join(" ").trim();
  // With grounds in hand the fallback would be a lie -- Capital Q *can*
  // explain this one -- but an answer made only of forbidden arithmetic
  // still leaves nothing to show, so the caller falls back to the
  // deterministic explanation it already has rather than to this message.
  return {
    text:
      text.length === 0 && !grounded(grounds)
        ? RECOMMENDATION_UNAVAILABLE_MESSAGE
        : text,
    removed,
  };
}
