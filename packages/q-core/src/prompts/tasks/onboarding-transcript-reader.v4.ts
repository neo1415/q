import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTranscriptReaderV2Result,
  OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V3 } from "./onboarding-transcript-reader.v3.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v4 — live onboarding sweep 2026-10-29
 * (production ed9be6cc4). Read by meaning, never by a phrase:
 * - "Eindhoven, the Netherlands" was saved as "Somewhere else" and a close
 *   "hoping to close in Q1" as their whole sentence: an option holds an
 *   answer that comes with more detail, and the value is always its key.
 * - "Series A mostly, sometimes seed" was saved as Series A only: v3's
 *   "what they mainly do" is for how they usually work, not for what they
 *   will consider, where an occasional one is still one of theirs.
 * - "prefer to follow a lead" was saved as "Follow in later rounds": an
 *   option is chosen by what its label means, never because its key is a
 *   word they used.
 */
const V3_OPTIONS_RULE =
  "- For a step with options, give the option key (or keys) whose meaning matches what they said, however they put it. When they say what they mainly or usually do and mention an occasional exception, the answer is what they mainly do: the exception is not one of their choices.";

const V4_OPTIONS_RULE = `- For a step with options, the value is the key (or keys) of the options whose meaning matches what they said, however they put it: never their sentence, never a label. Choose an option by what its label means; a key is only an id, so never choose an option because its key is a word they used.
- An answer that comes with more detail still names the option that holds it: a city or a region inside a listed country is that country; a time they name (a month, a quarter, "by summer") is read against today's date in the notes and is the option whose span holds it.
- When a step asks how they usually work (their role in a round, how they follow up), the answer is what they mainly do: an occasional exception they mention is not one of their choices. When a step asks what they will consider (stages, sectors, countries, cheque types), everything they say they do, even sometimes, is one of their choices.`;

if (!ONBOARDING_TRANSCRIPT_READER_V3.template.includes(V3_OPTIONS_RULE)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v4 extends v3, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V4: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV2Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "Live onboarding sweep 2026-10-29: the value is always an option key, an answer with more detail (a city, a quarter) names the option holding it, options are chosen by their label's meaning never a key's word, and what they will consider includes what they do only sometimes.",
  effectiveFrom: "2026-10-29",
  template: ONBOARDING_TRANSCRIPT_READER_V3.template.replace(
    V3_OPTIONS_RULE,
    V4_OPTIONS_RULE,
  ),
};
