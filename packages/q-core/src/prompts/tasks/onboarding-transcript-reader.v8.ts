import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTranscriptReaderV3Result,
  OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V7 } from "./onboarding-transcript-reader.v7.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v8 — live acceptance 2026-10-30
 * (production 4bcfa584b, a fictional founder and investor, typed):
 *
 * - Q asked what the founding team covers, "such as product, engineering,
 *   sales and partnerships, or operations"; the founder skipped it, and
 *   their later "Yes, that looks right" (to the review) was read as
 *   agreeing to the examples, written over the skip. Examples in Q's
 *   question are not a value read back, and a skip stays a skip.
 * - "We write cheques of EUR 750k to 3 million" was read as "actively
 *   investing" before Q asked; the investor then said they did not know.
 *   A step is answered only by words that answer it.
 * - "Skip the rest of the optional ones" set aside only the three Q had
 *   just named; every other optional question was asked anyway.
 *
 * Code still decides what may be written: a skipped step changes only on
 * the person's own words after the skip (onboarding-conversation.ts).
 */
const V7_READ_BACK =
  "- When Q read something back or suggested a value and the person agreed to it in their very next line, that value is their answer: quote their agreeing words.";
const V8_READ_BACK = `${V7_READ_BACK}
- Examples Q lists inside a question ("such as product, engineering or sales") are not something read back or suggested: a yes to such a question, or to anything else, is not a choice of those examples. Only Q's line just before their yes counts, and only a value Q put to them there as theirs.`;
const V7_GUESS =
  "- Never guess and never fill a gap: what they did not say stays unknown, which is fine.";
const V8_GUESS = `${V7_GUESS}
- A step is answered only by words that answer what it asks. Never work one step out from words about another (that they write cheques of some size says nothing about whether they are investing right now).
- A step whose record says they chose to skip it stays skipped: give it only from their own words said after they skipped it that give its answer, never from a yes to something else.`;
const V7_DECLINED =
  "- When they say plainly that they do not have what an optional step asks for (no website yet, no revenue so far), that settles it: put it under declined with those words, never as a value, so it is not asked again.";
const V8_DECLINED = `${V7_DECLINED}
- When they say they do not know the answer to an optional step Q asked them, put it under declined with those words, even when something is on record for it.
- When they ask to skip all the remaining optional questions (the rest, all the optional ones, that's everything), put every optional step that has nothing on record and was not skipped under declined, each with those words. Never a required step.`;

for (const anchor of [V7_READ_BACK, V7_GUESS, V7_DECLINED]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V7.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v8 extends v7, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V8: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV3Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Live acceptance 2026-10-30 (4bcfa584b): examples in Q's question are never agreed to; a step is answered only by words that answer it; a skip stays a skip; not knowing declines an optional step; skipping the rest declines every remaining optional step.",
  effectiveFrom: "2026-10-30",
  template: ONBOARDING_TRANSCRIPT_READER_V7.template
    .replace(V7_READ_BACK, V8_READ_BACK)
    .replace(V7_GUESS, V8_GUESS)
    .replace(V7_DECLINED, V8_DECLINED),
};
