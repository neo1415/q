import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTranscriptReaderV2Result,
  OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V2 } from "./onboarding-transcript-reader.v2.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v3 — v2, with what someone usually does
 * read as their answer (production re-test 2026-10-28: "we like to lead
 * sometimes but mostly follow" was saved as lead AND follow). An
 * occasional exception they mention is not one of their choices. Read by
 * meaning, never by a phrase.
 */
const V2_OPTIONS_RULE =
  "- For a step with options, give the option key (or keys) whose meaning matches what they said, however they put it.";

const V3_OPTIONS_RULE = `${V2_OPTIONS_RULE} When they say what they mainly or usually do and mention an occasional exception, the answer is what they mainly do: the exception is not one of their choices.`;

if (!ONBOARDING_TRANSCRIPT_READER_V2.template.includes(V2_OPTIONS_RULE)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v3 extends v2, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V3: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV2Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Production re-test 2026-10-28: what they mainly do is the answer; an occasional exception they mention is not one of their choices.",
  effectiveFrom: "2026-10-28",
  template: ONBOARDING_TRANSCRIPT_READER_V2.template.replace(
    V2_OPTIONS_RULE,
    V3_OPTIONS_RULE,
  ),
};
