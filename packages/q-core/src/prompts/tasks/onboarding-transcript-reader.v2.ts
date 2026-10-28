import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_UNTRUSTED,
  ONBOARDING_TRANSCRIPT_READER_V2_SCHEMA_VERSION,
  OnboardingTranscriptReaderV2ResultSchema,
  OnboardingTranscriptReaderVariablesSchema,
  type OnboardingTranscriptReaderV2Result,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V1 } from "./onboarding-transcript-reader.v1.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v2 — v1, with each answer saying whether a
 * list is the whole list or adds to what is on record (owner 2026-10-28:
 * the investor's hard exclusions "crypto and gambling" were replaced by
 * "adult content", said later as one more). Read by meaning, never by a
 * phrase; code adds or replaces accordingly, keeping history either way.
 */
const V1_CATEGORY_RULE =
  "- For a category step (sectors, countries, regions, stages named in their words), give each category in their words, one per item.";

const V2_LIST_RULE = `${V1_CATEGORY_RULE}
- For a step that holds a list (several options, or categories), say whether what you give is the whole list. replaces is true only when they meant it as the whole list: they corrected or replaced what they said before or what is on record, or said that is all of it. When they are adding more, give the new items and set replaces to false. For every other step, replaces is false.`;

const V1_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false}], "declined": [{"stepKey": "...", "quote": "..."}]}';
const V2_RESPONSE =
  '{"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false, "replaces": false}], "declined": [{"stepKey": "...", "quote": "..."}]}';

if (
  !ONBOARDING_TRANSCRIPT_READER_V1.template.includes(V1_CATEGORY_RULE) ||
  !ONBOARDING_TRANSCRIPT_READER_V1.template.includes(V1_RESPONSE)
) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v2 extends v1, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V2: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV2Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-28: a list answer says whether it is the whole list (a correction or replacement, by meaning) or adds to what is on record.",
  effectiveFrom: "2026-10-28",
  variables: {
    schema: OnboardingTranscriptReaderVariablesSchema,
    untrusted: [...ONBOARDING_TRANSCRIPT_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_V2_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderV2ResultSchema,
  },
  template: ONBOARDING_TRANSCRIPT_READER_V1.template
    .replace(V1_CATEGORY_RULE, V2_LIST_RULE)
    .replace(V1_RESPONSE, V2_RESPONSE),
};
