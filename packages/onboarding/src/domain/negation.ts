import { mentions, normalise } from "./text.js";

/**
 * Negation, contrast and scope in a person's sentence (CQ-Q-VOICE-001 A §7).
 *
 *   "We do fintech."                                  fintech: said
 *   "We don't do fintech."                            fintech: NOT said
 *   "We're not really fintech — we're logistics."     fintech: NOT said; logistics: said
 *   "Unlike fintech companies, we..."                 fintech: NOT said
 *   "Nigeria and Ghana, but not Kenya."               Nigeria, Ghana: said; Kenya: NOT said
 *
 * A sentence is read clause by clause. A clause is what sits between
 * sentence punctuation, a comma, or a contrast word ("but", "though",
 * "whereas", "unlike", "except"). Inside a clause, everything after a
 * negation marker is what the person is NOT saying; everything before it,
 * and every clause without a marker, is what they are saying. Matching
 * works on the affirmative text only, so a mention that lives only in a
 * negated span is never an answer — and never a taxonomy phrase either.
 *
 * Nothing here decides meaning beyond that: it does not guess, it does
 * not resolve "not X" into some other option, and it consults no model.
 */

/** Words that turn what follows them, in their clause, into what the person is not saying. */
export const NEGATION_MARKERS: readonly string[] = [
  "not",
  "no",
  "never",
  "beyond",
  "past",
  "without",
  "instead of",
  "rather than",
  "more than",
  "no longer",
  "not just",
  "not really",
  "isn't",
  "isn't really",
  "aren't",
  "aren't really",
  "wasn't",
  "weren't",
  "don't",
  "doesn't",
  "didn't",
  "haven't",
  "hasn't",
  "won't",
  "wouldn't",
  "can't",
  "cannot",
  "ex",
  "unlike",
  "except",
  "excluding",
  "other than",
  "neither",
  "nor",
  "stopped",
  "avoid",
  "avoiding",
  "steer clear of",
  "stay away from",
];

const MARKER_PATTERN = `(?:${NEGATION_MARKERS.map((m) => m.replace(/'/g, "'"))
  .sort((a, b) => b.length - a.length)
  .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|")})`;

/** A marker as a whole word (or words) inside a normalised clause. */
const MARKER_IN_CLAUSE = new RegExp(`(?:^| )${MARKER_PATTERN}(?= |$)`);

/**
 * Clauses of the raw sentence, before normalisation: sentence punctuation,
 * commas, dashes and contrast words each end one.
 */
export function clausesOf(text: string): readonly string[] {
  // A period or comma inside a figure ("$1.5m", "1,000") is not a boundary.
  return text
    .split(
      /[;!?]+|\.(?=\s|$)|,(?!\d)|:(?=\s|$)|\s[-–—]\s|\(|\)|\b(?:but|though|although|whereas|however|while|except that|unlike)\b/i,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * The parts of the sentence the person is affirming, as one normalised
 * text: every clause with no marker, plus the words before the first
 * marker of a clause that has one. Contrast words ("unlike") split a clause
 * AND negate what follows them, so "unlike fintech companies" is not
 * affirmed although it is its own clause.
 */
export function affirmativeText(text: string): string {
  const parts: string[] = [];
  const raw = text;
  // A clause introduced by "unlike" / "except" is a negated clause: the
  // splitter removed the word, so it is re-detected on the raw text.
  const negatedLeads = [...raw.matchAll(/\b(?:unlike|except(?: for)?)\b/gi)]
    .map((m) => m.index ?? -1)
    .filter((i) => i >= 0);
  let cursor = 0;
  for (const clause of clausesOf(raw)) {
    const at = raw.indexOf(clause, cursor);
    cursor = at >= 0 ? at + clause.length : cursor;
    const introducedByNegatedLead = negatedLeads.some(
      (lead) => at >= 0 && lead < at && raw.slice(lead, at).trim().length <= 12,
    );
    if (introducedByNegatedLead) {
      continue;
    }
    const normalised = normalise(clause);
    const marker = MARKER_IN_CLAUSE.exec(normalised);
    if (marker === null) {
      parts.push(normalised);
      continue;
    }
    const before = normalised.slice(0, marker.index).trim();
    if (before.length > 0) {
      parts.push(before);
    }
  }
  return parts.join(" , ");
}

/**
 * True when the phrase occurs in the sentence but never in its affirmative
 * parts: every mention of it is something the person said they are not.
 */
export function negatedMention(text: string, phrase: string): boolean {
  return mentions(text, phrase) && !mentions(affirmativeText(text), phrase);
}

/** True when the phrase occurs in what the person is affirming. */
export function affirmedMention(text: string, phrase: string): boolean {
  return mentions(affirmativeText(text), phrase);
}
