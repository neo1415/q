import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_V5_SCHEMA_VERSION,
  OnboardingTranscriptReaderV5ResultSchema,
  type OnboardingTranscriptReaderV5Result,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V9 } from "./onboarding-transcript-reader.v9.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v10 — live final re-check 2026-10-31
 * (production 68ab54317, fictional accounts, typed):
 *
 * - Q offered "change your deployment status to undecided?", the investor
 *   said "Yes, please.", and "Yes, please." was kept as the step's text;
 *   a "yes" to a founder's say-back joined a category note ("…; yes").
 *   Each answer now says whether their words only agree to what Q put to
 *   them (`affirms`); the value is then the value Q offered, and code never
 *   keeps agreeing words as an answer's text or note.
 * - Q asked about pilots and the reporting currency in one line; they gave
 *   the currency and their figures, and pilots was set aside as skipped.
 *   Not answering part of a question is neither declining it nor not
 *   knowing it, and each decline or "do not know" says whether their own
 *   words say so (`saidSo`); code acts only on those.
 */
const V9_SOURCE =
  "When in doubt, INFERRED: an inferred value is put to them to confirm, never saved as theirs.";
const V10_SOURCE = `${V9_SOURCE}
- affirms: true when their words for this value only agree to what Q's line just before put to them (a yes, "please do", "that's right"). The value is then exactly what Q put to them: the option id whose label means what Q offered, the number, or Q's words; never their agreeing words, and ownWords is false. If what Q offered matches no option and is not a number or words for the step, leave the step out. False when their own words give the value.`;
const V9_DECLINE =
  '- An optional step they plainly chose not to answer ("no preference", "skip that", "rather not say") goes under declined, with their words. A required step is never declined: leave it out.';
const V10_DECLINE = `${V9_DECLINE}
- Not answering part of what Q asked is neither declining it nor not knowing it: when Q asked two things and they answered one, leave the other out; Q will ask it again. saidSo (declined and notKnown): true only when their own words say they skip it, do not have it, do not know it or have not decided it; false otherwise.`;
const V9_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false, "aboutStep": false, "source": "STATED"}], "declined": [{"stepKey": "...", "quote": "..."}], "notKnown": [{"stepKey": "...", "quote": "..."}]}';
const V10_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false, "aboutStep": false, "source": "STATED", "affirms": false}], "declined": [{"stepKey": "...", "quote": "...", "saidSo": true}], "notKnown": [{"stepKey": "...", "quote": "...", "saidSo": true}]}';

for (const anchor of [V9_SOURCE, V9_DECLINE, V9_RESPONSE]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V9.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v10 extends v9, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V10: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV5Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "Live final re-check 2026-10-31 (68ab54317): an answer says whether their words only agree to what Q offered (affirms; the value is Q's, never their yes); a decline or not-known says whether their own words say so (saidSo); an unanswered part of a question is neither.",
  effectiveFrom: "2026-10-31",
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_V5_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderV5ResultSchema,
  },
  template: ONBOARDING_TRANSCRIPT_READER_V9.template
    .replace(V9_SOURCE, V10_SOURCE)
    .replace(V9_DECLINE, V10_DECLINE)
    .replace(V9_RESPONSE, V10_RESPONSE),
};
