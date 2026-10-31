import { ONBOARDING_TRANSCRIPT_READER_V12 } from "./onboarding-transcript-reader.v12.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v13 — live check 2026-10-31 (production
 * d6f606053, fictional founder "Lobbykylm Lockers" and investor "Nordlicht
 * Saatgut Capital", typed):
 *
 * - "We are raising 1.2 million euros, equity, and want to close in about
 *   five months", said to a question about traction, was read as no answer
 *   at all, and two lines later Q asked "Are you actively raising now?".
 *   Words that say outright what a step asks answer it, whichever question
 *   they were said to; the rule against working a step out from words about
 *   another stays.
 * - "B2B software, climate and energy tech, logistics and industrial
 *   automation": "industrial automation" was never given as a category, so
 *   it was neither matched nor kept. Every category they name is its own
 *   item, even one that may not be listed.
 * - Runway was saved as "Burn is about 40k euros a month and we have a bit
 *   under a year of runway": a quote is the part of their line about that
 *   step only, when one line answers several.
 */
const V12_CATEGORY =
  "- For a category step (sectors, countries, regions, stages named in their words), give each category in their words, one per item. Only the words that name a category, never a sentence about what they do or who they serve; when their words name no category, leave the step out and Q will ask.";
const V13_CATEGORY =
  "- For a category step (sectors, countries, regions, stages named in their words), give every category they name, each its own item in their words, even one you think may not be listed: Capital Q matches each to its categories and keeps the rest in their words. Only the words that name a category, never a sentence about what they do or who they serve; when their words name no category, leave the step out and Q will ask.";
const V12_QUOTE =
  "- quote: their exact words, verbatim, from one PERSON line, that give the answer.";
const V13_QUOTE =
  '- quote: their exact words, verbatim, from one PERSON line, that give the answer: only the part of that line about this step when the line also answers other steps ("we have a bit under a year of runway", never the burn said before it).';
const V12_ONLY_ANSWERS =
  "- A step is answered only by words that answer what it asks. Never work one step out from words about another (that they write cheques of some size says nothing about whether they are investing right now).";
const V13_ONLY_ANSWERS = `${V12_ONLY_ANSWERS} Words that say outright what a step asks do answer it, whichever question they were said to: "we are raising 1.2 million euros" says they are raising now (and gives the amount and currency of the raise, for steps that ask them).`;

for (const anchor of [V12_CATEGORY, V12_QUOTE, V12_ONLY_ANSWERS]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V12.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v13 extends v12, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V13: typeof ONBOARDING_TRANSCRIPT_READER_V12 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V12,
    version: 13,
    status: "ACTIVE",
    changeDescription:
      "Live check 2026-10-31 (d6f606053): words that say outright what a step asks answer it whatever question they were said to; every category named is its own item, listed or not; a quote is the part of the line about that step.",
    effectiveFrom: "2026-10-31",
    template: ONBOARDING_TRANSCRIPT_READER_V12.template
      .replace(V12_CATEGORY, V13_CATEGORY)
      .replace(V12_QUOTE, V13_QUOTE)
      .replace(V12_ONLY_ANSWERS, V13_ONLY_ANSWERS),
  };
