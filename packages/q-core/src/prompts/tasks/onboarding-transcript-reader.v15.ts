import { ONBOARDING_TRANSCRIPT_READER_V14 } from "./onboarding-transcript-reader.v14.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v15 — onboarding P1-1, live run 1 on v14
 * (integration owner, 7 Nov 2026; tuned on the dev misses only, never the
 * held-out rows): about 70% of decisions were right, and every miss but one
 * kept their words where a summary was wanted:
 *
 * - one line answering two LONG_TEXT steps was kept for each step (6 of 13
 *   misses): the two-step rule now comes first and holds however clear the
 *   line;
 * - short rambles were kept (4): rambling is now told by how it is said
 *   (hedging, circling, restarts, repeats, more than a little filler),
 *   however short, and a long spoken answer is rambling.
 *
 * Code still checks every "their own words" claim, and holds a spoken one
 * to a stricter bar (q-core conversation/their-words.ts).
 */
const V14_LONG_TEXT =
  "- A step of kind LONG_TEXT is told at length (what the company does, the problem, how it makes money, and the like). Judge how they told it, typed or spoken, whatever its length. CLEAR: it says what it means, in order, without much repetition or backtracking (a long typed paragraph or list can be clear, and so can a spoken answer with a little filler or imperfect English). Then give THEIR OWN WORDS for that step with only filler removed (um, uh, like, you know, I mean, sort of, basically, false starts, a word said twice, and words they took back when they corrected themselves, keeping what they corrected it to): nothing reordered, reworded, corrected or added, and ownWords true; it is saved as they said it. RAMBLING: repetitive, backtracking or wandering, usually spoken, however short. Then give a short professional summary as it should read on their profile, a plain statement about them or their company, shorter than what they said, keeping every figure, name and place they gave for it, and ownWords false; Q says it back and saves only what they agree to. When one line of theirs answers more than one LONG_TEXT step, give a summary for each (ownWords false), so Q says them back together. When unsure, summarise.";
const V15_LONG_TEXT =
  '- A step of kind LONG_TEXT is told at length (what the company does, the problem, how it makes money, and the like). Decide how to give it, in this order. FIRST: when one line of theirs speaks to more than one LONG_TEXT step, never give their own words for any of them, however clear the line: give a short summary for each step (ownWords false), each only about its own step, so Q says them back together. Otherwise judge how they told it, typed or spoken, whatever its length. RAMBLING, even when short: it hedges or circles ("I guess", "sort of", "kind of", "it\'s like"), restarts, repeats itself, wanders off and back, or would need more than a few words of filler dropped to read cleanly; a spoken answer that runs long is rambling. Then give a short professional summary as it should read on their profile, a plain statement about them or their company, shorter than what they said, keeping every figure, name and place they gave for it, and ownWords false; Q says it back and saves only what they agree to. CLEAR: it says what it means, in order, with at most a little filler (a long typed paragraph or list can be clear, and so can a short spoken answer or imperfect English). Then give THEIR OWN WORDS for that step with only filler removed (um, uh, like, you know, I mean, sort of, basically, false starts, a word said twice, and words they took back when they corrected themselves, keeping what they corrected it to): nothing reordered, reworded, corrected or added, and ownWords true; it is saved as they said it. When unsure, summarise.';

if (!ONBOARDING_TRANSCRIPT_READER_V14.template.includes(V14_LONG_TEXT)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v15 extends v14, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V15: typeof ONBOARDING_TRANSCRIPT_READER_V14 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V14,
    version: 15,
    status: "ACTIVE",
    changeDescription:
      "Onboarding P1-1, live run 1 (dev misses only): a line speaking to two LONG_TEXT steps is summarised for each, first and however clear; rambling is told by how it is said, however short, and a long spoken answer is rambling.",
    effectiveFrom: "2026-11-07",
    template: ONBOARDING_TRANSCRIPT_READER_V14.template.replace(
      V14_LONG_TEXT,
      V15_LONG_TEXT,
    ),
  };
