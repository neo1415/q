import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTranscriptReaderV2Result,
  OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V4 } from "./onboarding-transcript-reader.v4.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v5 — live recheck 2026-10-30 (production
 * 4d71bcf74): "We prefer to follow a lead" was saved as "Follow in later
 * rounds" despite v4's rule, because the option's key was the word they
 * used. The reader no longer sees keys: each option is an opaque id (o1,
 * o2, ...) beside its label, and code maps the id back to the key.
 */
const V4_FIRST =
  "- For a step with options, the value is the key (or keys) of the options whose meaning matches what they said, however they put it: never their sentence, never a label. Choose an option by what its label means; a key is only an id, so never choose an option because its key is a word they used.";

const V5_FIRST =
  "- For a step with options, each option is listed as an id and its label (o1: ..., o2: ...). The value is the id (or ids) of the options whose label means what they said, however they put it: never their sentence, never a label. Choose by what each label means as a whole, never because a label shares a word with theirs.";

if (!ONBOARDING_TRANSCRIPT_READER_V4.template.includes(V4_FIRST)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v5 extends v4, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V5: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV2Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "Live recheck 2026-10-30: options are shown as opaque ids beside their labels, never keys, so a key that is a word they used cannot pull the reading; the value is the option id.",
  effectiveFrom: "2026-10-30",
  template: ONBOARDING_TRANSCRIPT_READER_V4.template.replace(
    V4_FIRST,
    V5_FIRST,
  ),
};
