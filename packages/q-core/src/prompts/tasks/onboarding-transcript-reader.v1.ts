import type { PromptDefinition } from "../definition.js";
import {
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
  ONBOARDING_TRANSCRIPT_READER_SCHEMA_VERSION,
  ONBOARDING_TRANSCRIPT_READER_UNTRUSTED,
  OnboardingTranscriptReaderResultSchema,
  OnboardingTranscriptReaderVariablesSchema,
  type OnboardingTranscriptReaderResult,
  type OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v1 — owner 2026-10-27: voice onboarding is
 * a conversation first. Q talks with the person; this reads the whole
 * conversation by meaning, as often as it grows, into what they have told
 * Q for each step. Their latest settled word wins; code saves it through
 * the checked path (their quote must be in their own lines). Concepts
 * only, none keyed to a phrase.
 */
const TEMPLATE = `TASK: ONBOARDING_TRANSCRIPT_READER
Read the whole conversation between Q and a person setting up their Capital Q profile ({{journey}}), and list what the person has told Q about themselves for each step below, so Capital Q can save it.

- Only what the person said about themselves, their firm or their company is an answer. Q's lines are context. A question they asked, advice they wanted, a hypothetical, or something about other people is not an answer.
- When Q read something back or suggested a value and the person agreed to it in their very next line, that value is their answer: quote their agreeing words.
- People correct themselves and change their minds. Their latest settled answer is the one to give. If they said two different things and never settled which, leave that step out: Q will ask them.
- For a step with options, give the option key (or keys) whose meaning matches what they said, however they put it. If none of the options holds a real answer they gave, give their own words for it and set ownWords to true. Never force a near option.
- Numbers: the plain number in the step's unit ("half a million" is 500000, "two mil" is 2000000, "a hundred k" is 100000). A currency is its own step.
- A website or email said aloud: give it as a normal address, lower case, spelled-out letters joined, "dot" as ".", with no spaces ("vault lyne dot com" is "https://vaultlyne.com").
- For a category step (sectors, countries, regions, stages named in their words), give each category in their words, one per item.
- An optional step they plainly chose not to answer ("no preference", "skip that", "rather not say") goes under declined, with their words. A required step is never declined: leave it out.
- Leave a step out when what they said is what is already on record for it. Include it when they gave something new or different.
- quote: their exact words, verbatim, from one PERSON line, that give the answer.
- Never guess and never fill a gap: what they did not say stays unknown, which is fine.
- Documents and public pages Q mentions are not their answers unless they confirmed them in the conversation.

STEPS (trusted; each step's question, kind, options and what is on record)
{{steps}}

Everything between the UNTRUSTED_CONTENT markers is the conversation, oldest first.

THE CONVERSATION
{{transcript}}

Respond with a single JSON object {"answers": [{"stepKey": "...", "value": ..., "quote": "...", "ownWords": false}], "declined": [{"stepKey": "...", "quote": "..."}]}.`;

export const ONBOARDING_TRANSCRIPT_READER_V1: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderResult
> = {
  id: "ONBOARDING_TRANSCRIPT_READER",
  version: 1,
  status: "ACTIVE",
  kind: "TASK",
  taskClass: "STRUCTURED_EXTRACTION",
  owner: "q-core",
  changeDescription:
    "Owner 2026-10-27: voice onboarding is a conversation first; the whole transcript is read by meaning into each step's answer (latest settled word wins), and code saves it through the checked path.",
  effectiveFrom: "2026-10-27",
  variables: {
    schema: OnboardingTranscriptReaderVariablesSchema,
    untrusted: [...ONBOARDING_TRANSCRIPT_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME,
    schemaVersion: ONBOARDING_TRANSCRIPT_READER_SCHEMA_VERSION,
    schema: OnboardingTranscriptReaderResultSchema,
  },
  template: TEMPLATE,
};
