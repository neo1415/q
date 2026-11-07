import { ONBOARDING_TRANSCRIPT_READER_V13 } from "./onboarding-transcript-reader.v13.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v14 — onboarding P1-1 (DECISIONS 77, owner
 * 7 Nov 2026; approved by the integration owner): Q judges when to
 * summarise. Before, every LONG_TEXT answer was read as words to be said
 * back, and code kept only lines of 30 words or fewer: a clear 40-word
 * typed answer was always summarised, and a 25-word spoken ramble was saved
 * with its filler. Now the reader judges how the answer was told:
 *
 * - CLEAR (says what it means, in order, without much repetition or
 *   backtracking, whatever its length, typed or spoken): their own words
 *   with only filler removed, ownWords true. Code checks that claim
 *   structurally (deletions only from their line, most of it kept) and
 *   saves it; anything else is said back.
 * - RAMBLING (long, repetitive, backtracking, mostly spoken): a short
 *   professional summary, ownWords false, held for their yes as before.
 *
 * Material Q-extracted facts still need their yes: a summary is never
 * saved until they agree to it.
 */
const V13_LONG_TEXT =
  "- A step of kind LONG_TEXT is told at length (what the company does, the problem, how it makes money, and the like) and is saved only as Q's summary that they agreed to.";
const V14_LONG_TEXT =
  "- A step of kind LONG_TEXT is told at length (what the company does, the problem, how it makes money, and the like). Judge how they told it, typed or spoken, whatever its length. CLEAR: it says what it means, in order, without much repetition or backtracking (a long typed paragraph or list can be clear, and so can a spoken answer with a little filler or imperfect English). Then give THEIR OWN WORDS for that step with only filler removed (um, uh, like, you know, I mean, sort of, basically, false starts, a word said twice, and words they took back when they corrected themselves, keeping what they corrected it to): nothing reordered, reworded, corrected or added, and ownWords true; it is saved as they said it. RAMBLING: repetitive, backtracking or wandering, usually spoken, however short. Then give a short professional summary as it should read on their profile, a plain statement about them or their company, shorter than what they said, keeping every figure, name and place they gave for it, and ownWords false; Q says it back and saves only what they agree to. When one line of theirs answers more than one LONG_TEXT step, give a summary for each (ownWords false), so Q says them back together. When unsure, summarise.";
const V13_UNTIL_AGREED =
  "Until they have agreed to one, give what they said for it in their own words, with their words as the quote.";
const V14_UNTIL_AGREED =
  "Until they have agreed to one, give it as judged above (their own words cleaned, or a summary), with their words as the quote.";

for (const anchor of [V13_LONG_TEXT, V13_UNTIL_AGREED]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V13.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v14 extends v13, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V14: typeof ONBOARDING_TRANSCRIPT_READER_V13 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V13,
    version: 14,
    status: "ACTIVE",
    changeDescription:
      "Onboarding P1-1 (DECISIONS 77): a LONG_TEXT answer is judged; a clear one (typed or spoken, any length) is their own words with only filler removed (ownWords true), a rambling one a short professional summary for their yes (ownWords false).",
    effectiveFrom: "2026-11-07",
    template: ONBOARDING_TRANSCRIPT_READER_V13.template
      .replace(V13_LONG_TEXT, V14_LONG_TEXT)
      .replace(V13_UNTIL_AGREED, V14_UNTIL_AGREED),
  };
