import { ONBOARDING_TRANSCRIPT_READER_V11 } from "./onboarding-transcript-reader.v11.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v12 — live check 2026-10-31 (production
 * 84d8ede07, fictional founder "Grannskap Harvest" and investor
 * "Halvmåne Partners", typed):
 *
 * - Saved summaries kept Q's lead-ins ("The problem you're addressing is
 *   that…", "The process is: …") and one began in lower case ("a
 *   marketplace where…"). A LONG_TEXT value is the content itself, as it
 *   reads on their profile: Q's words for it without the words that only
 *   introduce the topic or speak to them, starting with a capital.
 * - "Consumer apps, gambling or crypto are a firm no" kept Gambling and
 *   Speculative crypto; "consumer apps", which no option holds, was lost.
 *   A part of a list no option holds is given too, in their words.
 * - "A bit under a year of runway" was left out (no exact figure), and Q
 *   later asked the runway in months. An approximate answer is an answer.
 */
const V11_AGREED =
  "the value is Q's words for that step exactly as Q said them (only the part about that step)";
const V12_AGREED =
  "the value is Q's words for that step as Q said them (only the part about that step, and only its content: see below)";
const V11_MANY =
  "each with Q's words for it copied exactly from that line (the same words may serve more than one step)";
const V12_MANY =
  "each with Q's words for it from that line (the same words may serve more than one step)";
const V11_THESIS =
  "- An investor's view or reasoning told at length about where and why they invest (their thesis) is LONG_TEXT for the step that keeps their own context or criteria in their words, beside any categories the same words name.";
const V12_THESIS = `${V11_THESIS}
- Q's words for a LONG_TEXT step are its content, as it should read on their profile: leave out Q's words that only introduce the topic or speak to them ("The problem you're addressing is that", "Your solution is", "The process is:", "So you're saying"), copy the rest as Q said it, and begin it with a capital letter. Never add words Q did not say.`;
const V11_OWN =
  "If none of the options holds a real answer they gave, give their own words for it and set ownWords to true. Never force a near option.";
const V12_OWN = `${V11_OWN} When the options hold some of what they gave and not the rest, give the ids of the options that hold it and, as further items of the same list, their own words for each part no option holds (ownWords stays false): every part they gave is kept.`;
const V11_NUMBERS =
  '- Numbers: the plain number in the step\'s unit ("half a million" is 500000, "two mil" is 2000000, "a hundred k" is 100000). A currency is its own step.';
const V12_NUMBERS = `${V11_NUMBERS}
- An approximate answer to a number step is an answer: when their words for it give no exact figure ("a bit under a year", "around a dozen", "most of the team"), give their words for it as the value, a string, with ownWords true and source STATED. Never leave it out and never turn it into a figure.`;

for (const anchor of [V11_AGREED, V11_MANY, V11_THESIS, V11_OWN, V11_NUMBERS]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V11.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v12 extends v11, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V12: typeof ONBOARDING_TRANSCRIPT_READER_V11 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V11,
    version: 12,
    status: "ACTIVE",
    changeDescription:
      "Live check 2026-10-31 (84d8ede07): a LONG_TEXT value is its content without Q's lead-in, capitalised; a part of a list no option holds is kept in their words; an approximate answer to a number step is their words, never left out.",
    effectiveFrom: "2026-10-31",
    template: ONBOARDING_TRANSCRIPT_READER_V11.template
      .replace(V11_AGREED, V12_AGREED)
      .replace(V11_MANY, V12_MANY)
      .replace(V11_THESIS, V12_THESIS)
      .replace(V11_OWN, V12_OWN)
      .replace(V11_NUMBERS, V12_NUMBERS),
  };
