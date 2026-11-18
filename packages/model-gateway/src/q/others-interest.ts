/**
 * QA F-44 (23 Oct 2026, run 190b1d58): an investor asked "Which other
 * investors have expressed interest in Maji Loop, and what cheque sizes
 * are they considering?" and Q said "No other investors … are recorded"
 * (two were). Other investors' interest, relationships and cheques are
 * theirs and the company's: withholding them is right, saying there are
 * none is not. Q says it can't share them, and counts or names only what
 * the asker may see (their own relationship, public announcements).
 */

const OTHERS_INTEREST =
  /\b(?:other|which|what|any|how\s+many|who\s+else|anyone\s+else)\b[^.?!]*\b(?:investors?|funds?|vcs?|firms?|backers?|angels?)\b[^.?!]*\b(?:interest(?:ed)?|want|keen|looking\s+at|talking\s+to|in\s+talks|cheques?|checks?|committed|commitments?|backing|investing|invested|pipeline|competing|competition)\b|\bwho\s+else\b[^.?!]*\b(?:interested|investing|looking|talking|bidding)\b/iu;

/**
 * Live re-check of 3b7145616 (16 Nov 2026): "Which investors suit us best,
 * excluding the ones we're already talking to?" opened with the
 * withholding line, unasked (owner: no repetitive or unprompted
 * disclosures). Talks, interest or fit whose other party is the asker
 * ("we're talking to", "interested in us", "suit us") are their own
 * pipeline and fit, not another investor's interest in a company: those
 * spans are set aside before the question is read for others' interest.
 */
const ASKERS_OWN = [
  /\b(?:we|i)(?:'re|'m|\s+are|\s+am|'ve\s+been|\s+have\s+been)?\s+(?:already\s+|currently\s+|now\s+|still\s+)?(?:talking|speaking|in\s+talks|in\s+touch|in\s+contact|in\s+conversation|meeting)\b/giu,
  /\b(?:interest(?:ed)?\s+in|talking\s+(?:to|with)|speaking\s+(?:to|with)|in\s+talks\s+with|in\s+touch\s+with|backing|investing\s+in|invested\s+in|keen\s+on|looking\s+at|committed\s+to)\s+(?:us|me|our)\b/giu,
  /\b(?:fit|fits|match|matches|suit|suits|suited\s+to)\s+(?:for\s+)?(?:me|my|us|our)\b/giu,
  /\b(?:good|best|right|strong|great)\s+(?:fit|match)\s+for\s+(?:me|my|us|our)\b/giu,
];

/** They ask about other investors' interest in a company. */
export function asksAboutOthersInterest(text: string): boolean {
  const plain = ASKERS_OWN.reduce(
    (said, own) => said.replace(own, " "),
    text.replace(/[’]/gu, "'"),
  );
  return (
    OTHERS_INTEREST.test(plain) &&
    /\b(?:other|else|any(?:one)?|which|who|how\s+many)\b/iu.test(plain) &&
    // "My investors" / "which investors fit me" are their own records.
    !/\b(?:my|our)\s+(?:investors?|pipeline|relationships?)\b/iu.test(plain) &&
    !/\b(?:fit|match)(?:es)?\s+(?:me|my|us|our)\b/iu.test(plain)
  );
}

/**
 * Audit 2026-11-13 item 17: the turn asks about other parties' interest or
 * activity when the reader read it so by meaning (TURN_READER v93
 * `othersActivity`, carried as `othersActivityAsked`) OR the word rule
 * above matches. The word rule stays as defence in depth: a reading that
 * failed, or missed it, never lets a plain ask through. Either one only
 * shapes how Q says it; the data itself is read solely through the Network
 * context's party checks (respond-to-interest `authoriseForCompany`,
 * relationship-status `requireRelationshipListingScope`), so no wording
 * can reach another investor's relationship.
 */
export function othersInterestAsked(
  request: { readonly othersActivityAsked?: boolean | undefined },
  text: string,
): boolean {
  return request.othersActivityAsked === true || asksAboutOthersInterest(text);
}

export const OTHERS_INTEREST_LINE =
  "I can't share other investors' interest or cheque sizes: that's between them and the company.";

/** Told to the model on such a turn. */
export const OTHERS_INTEREST_NOTE = `OTHER INVESTORS' INTEREST IS PRIVATE: they asked about other investors' interest or cheques in a company. Capital Q never shares another investor's interest, relationship, cheque or commitment, and never says how many there are. Say so plainly, in these words or close to them: "${OTHERS_INTEREST_LINE}" Never say there are none, that none are recorded, or that you found none. Then give only what this person may see: their own relationship with the company, and any public announcement of a round you actually found.`;

const CLAIMS_NONE =
  /[^.!?\n]*\b(?:no\s+other\s+(?:investors?|funds?|firms?)|no\s+(?:investors?|interest|cheque\s+sizes?|commitments?)\s+(?:(?:or\s+\w+(?:\s+\w+)?\s+)?(?:are|is|have\s+been|has\s+been|were|was)\s+)?(?:recorded|on\s+record|listed|found|known)|(?:there\s+are|I\s+(?:see|found|have))\s+no\s+(?:other\s+)?(?:investors?|interest)|none\s+(?:are|is)\s+recorded)\b[^.!?\n]*[.!?]?/giu;

/**
 * The answer as said: a claim that no other investor is interested is
 * replaced by the plain withholding line, which also leads when absent.
 */
export function withOthersInterestWithheld(text: string): string {
  const removed = text.replace(CLAIMS_NONE, "").replace(/[ \t]{2,}/gu, " ");
  const rest = removed.replace(/\n{3,}/gu, "\n\n").trim();
  if (/\bcan(?:'|’)?t\s+share\b|\bcannot\s+share\b/iu.test(rest)) return rest;
  return rest.length === 0
    ? OTHERS_INTEREST_LINE
    : `${OTHERS_INTEREST_LINE}\n\n${rest}`;
}
