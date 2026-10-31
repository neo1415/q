import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_V4_SCHEMA_VERSION,
  OnboardingTranscriptReaderV4ResultSchema,
  type OnboardingTranscriptReaderV4Result,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V8 } from "./onboarding-transcript-reader.v8.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v9 — live re-check 2026-10-31 (production
 * 91b19d615, a fictional investor, typed):
 *
 * - "We write cheques of EUR 750k to 3 million" was read as "actively
 *   investing" before Q asked, and saved, although v8 said that it must
 *   not be. A rule in a prompt did not hold the model, so the reading now
 *   says, per value, whether the person STATED it or Q INFERRED it
 *   (`source`), and code saves only stated values; an inferred one is held
 *   as a suggestion for their yes.
 * - "I don't know honestly, the partners haven't decided" to a required
 *   step was given as their own words (ownWords) and saved as its text.
 *   Not knowing is never a value: it goes under notKnown, needed or
 *   optional, and code keeps the step unknown.
 */
const V8_OWN_WORDS =
  "If none of the options holds a real answer they gave, give their own words for it and set ownWords to true. Never force a near option.";
const V9_OWN_WORDS =
  "If none of the options holds a real answer they gave, give their own words for it and set ownWords to true. Never force a near option. That they do not know, or have not decided, is not an answer and never their own words for a step: it goes under notKnown.";
const V8_NOT_KNOWING =
  "- When they say they do not know the answer to an optional step Q asked them, put it under declined with those words, even when something is on record for it.";
const V9_NOT_KNOWING =
  "- When they say they do not know the answer to a step Q asked them, or that it is not decided yet, put it under notKnown with those words, needed or optional, even when something is on record for it. Never as a value, and never under declined.";
const V8_ABOUT_STEP =
  "- aboutStep: true only when their words are about this step itself, as above; false when they answer a different question.";
const V9_ABOUT_STEP = `${V8_ABOUT_STEP}
- source: STATED when their words say this value for this step (or they agreed to it when Q put it to them as theirs). INFERRED when you worked it out from words about something else, or from what their words suggest without saying it. When in doubt, INFERRED: an inferred value is put to them to confirm, never saved as theirs.`;
const V8_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false, "aboutStep": false}], "declined": [{"stepKey": "...", "quote": "..."}]}';
const V9_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false, "aboutStep": false, "source": "STATED"}], "declined": [{"stepKey": "...", "quote": "..."}], "notKnown": [{"stepKey": "...", "quote": "..."}]}';

for (const anchor of [
  V8_OWN_WORDS,
  V8_NOT_KNOWING,
  V8_ABOUT_STEP,
  V8_RESPONSE,
]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V8.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v9 extends v8, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V9: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV4Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "Live re-check 2026-10-31 (91b19d615): each value says whether the person STATED it or Q INFERRED it (code saves only stated values; inferred ones are held for their yes); not knowing goes under notKnown for any step, never a value.",
  effectiveFrom: "2026-10-31",
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_V4_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderV4ResultSchema,
  },
  template: ONBOARDING_TRANSCRIPT_READER_V8.template
    .replace(V8_OWN_WORDS, V9_OWN_WORDS)
    .replace(V8_NOT_KNOWING, V9_NOT_KNOWING)
    .replace(V8_ABOUT_STEP, V9_ABOUT_STEP)
    .replace(V8_RESPONSE, V9_RESPONSE),
};
