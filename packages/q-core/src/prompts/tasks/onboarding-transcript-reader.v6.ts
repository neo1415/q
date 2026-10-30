import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_UNTRUSTED,
  ONBOARDING_TRANSCRIPT_READER_V3_SCHEMA_VERSION,
  OnboardingTranscriptReaderV3ResultSchema,
  OnboardingTranscriptReaderVariablesSchema,
  type OnboardingTranscriptReaderV3Result,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V5 } from "./onboarding-transcript-reader.v5.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v6 — live recheck 2026-10-30 (production
 * 891425cbe), two readings:
 *
 * - A founder kept their deck's description; Q then asked how they would
 *   describe their industry, and "robotics for warehouse logistics"
 *   replaced the description. Words answer the question they were said
 *   to: a step on record changes only when their words are about that
 *   step, and each answer says whether its words are about that step
 *   (`aboutStep`), which code checks beside the question Q's line asked.
 * - "Usually EUR 500k to 2m per cheque", said to another question, was not
 *   read into the cheque steps until the finishing pass. A range of
 *   amounts is its two ends, whatever question it was said to.
 */
const V5_NUMBERS =
  '- Numbers: the plain number in the step\'s unit ("half a million" is 500000, "two mil" is 2000000, "a hundred k" is 100000). A currency is its own step.';

const V6_NUMBERS = `${V5_NUMBERS}
- A range of amounts they give (from one figure to another) is its two ends: the lower figure answers the step for the smallest amount and the higher figure the step for the largest, when the setup has such steps, however they put it ("usually", "typically", "per cheque") and whichever question it was said to. A typical amount is a single figure they name; never a point you work out inside their range.`;

const V5_ON_RECORD =
  "- Leave a step out when what they said is what is already on record for it. Include it when they gave something new or different.";

const V6_ON_RECORD = `${V5_ON_RECORD}
- Words answer the question they were said to. A step that already has something on record changes only when their words are about that step: Q's question just before asked about it, they named what the step is about as the thing they are giving or changing, or they corrected or added to what they said for it. Words that answer a different question (their industry, when their description is on record) are never a new answer to the step on record, however close in meaning.
- aboutStep: true only when their words are about this step itself, as above; false when they answer a different question.`;

const V5_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false}], "declined": [{"stepKey": "...", "quote": "..."}]}';
const V6_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false, "aboutStep": false}], "declined": [{"stepKey": "...", "quote": "..."}]}';

for (const anchor of [V5_NUMBERS, V5_ON_RECORD, V5_RESPONSE]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V5.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v6 extends v5, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V6: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV3Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    "Live recheck 2026-10-30: a step on record changes only on words about that step (each answer says whether its words are about that step); a range of amounts is its two ends, whatever question it was said to.",
  effectiveFrom: "2026-10-30",
  variables: {
    schema: OnboardingTranscriptReaderVariablesSchema,
    untrusted: [...ONBOARDING_TRANSCRIPT_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_V3_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderV3ResultSchema,
  },
  template: ONBOARDING_TRANSCRIPT_READER_V5.template
    .replace(V5_NUMBERS, V6_NUMBERS)
    .replace(V5_ON_RECORD, V6_ON_RECORD)
    .replace(V5_RESPONSE, V6_RESPONSE),
};
