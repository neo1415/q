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

/** They ask about other investors' interest in a company. */
export function asksAboutOthersInterest(text: string): boolean {
  const plain = text.replace(/[’]/gu, "'");
  return (
    OTHERS_INTEREST.test(plain) &&
    /\b(?:other|else|any(?:one)?|which|who|how\s+many)\b/iu.test(plain) &&
    // "My investors" / "which investors fit me" are their own records.
    !/\b(?:my|our)\s+(?:investors?|pipeline|relationships?)\b/iu.test(plain) &&
    !/\b(?:fit|match)(?:es)?\s+(?:me|my|us|our)\b/iu.test(plain)
  );
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
