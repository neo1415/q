import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_V5_SCHEMA_VERSION,
  OnboardingTranscriptReaderV5ResultSchema,
  type OnboardingTranscriptReaderV5Result,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V10 } from "./onboarding-transcript-reader.v10.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v11 — live check 2026-10-31 (production
 * 2e79954fd, fictional founder "Tidevand" and investor "Lauwersmeer",
 * typed):
 *
 * - One yes to Q's summary of the company, its solution and how it works
 *   saved only the description; the solution and how it works were put to
 *   the founder again one by one. A yes to a summary covers every LONG_TEXT
 *   step it spoke to, each in Q's words from that line.
 * - A founder's long description was given as the sector, in their words.
 *   A category is a category; a sentence about the business is not one.
 * - "We'd rather not see consumer apps, gambling or crypto, that's a firm
 *   no for our LPs" was read as the soft preference. How firm a no is
 *   decides the step, by meaning, not the words it opens with.
 * - An investor's thesis told at length got a one-line paraphrase and was
 *   never put to them to confirm: it is LONG_TEXT for the step that keeps
 *   their own context, as a founder's narrative is.
 */
const V10_LONG_TEXT =
  "Until they have agreed to one, give what they said for it in their own words, with their words as the quote.";
const V11_LONG_TEXT = `${V10_LONG_TEXT}
- When their yes agrees to one summary of Q's that spoke to several LONG_TEXT steps, give every step that summary spoke to, each with Q's words for it copied exactly from that line (the same words may serve more than one step), affirms true and their agreeing words as the quote. A step the summary did not speak to is left out.
- An investor's view or reasoning told at length about where and why they invest (their thesis) is LONG_TEXT for the step that keeps their own context or criteria in their words, beside any categories the same words name.`;
const V10_CATEGORY =
  "- For a category step (sectors, countries, regions, stages named in their words), give each category in their words, one per item.";
const V11_CATEGORY = `${V10_CATEGORY} Only the words that name a category, never a sentence about what they do or who they serve; when their words name no category, leave the step out and Q will ask.
- How firm a "no" is decides its step, by what they mean: when they say it is firm, absolute, never, or ruled out by their fund or LPs, it goes to the step that excludes outright, even if they began with softer words; a preference to see less of something goes to the softer step. One "no" goes to one of them, never both.`;

for (const anchor of [V10_LONG_TEXT, V10_CATEGORY]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V10.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v11 extends v10, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V11: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV5Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V10,
  version: 11,
  status: "ACTIVE",
  changeDescription:
    "Live check 2026-10-31 (2e79954fd): a yes to one summary covers every LONG_TEXT step it spoke to, in Q's words; a category step takes category words only; a firm no is the outright exclusion; an investor's thesis is LONG_TEXT for their own context.",
  effectiveFrom: "2026-10-31",
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_V5_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderV5ResultSchema,
  },
  template: ONBOARDING_TRANSCRIPT_READER_V10.template
    .replace(V10_LONG_TEXT, V11_LONG_TEXT)
    .replace(V10_CATEGORY, V11_CATEGORY),
};
