import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_SCHEMA_NAME,
  DELEGATION_READER_SCHEMA_VERSION,
  DELEGATION_READER_UNTRUSTED,
  DelegationReaderResultSchema,
  DelegationReaderVariablesSchema,
  type DelegationReaderResult,
  type DelegationReaderVariables,
} from "../schemas/delegation-reader.js";

/**
 * DELEGATION_READER v1 — what authority the person has just given Q over
 * their own onboarding (lead, 2026-09-25). Concepts only, none keyed to a
 * phrase.
 */
const TEMPLATE = `TASK: DELEGATION_READER
Read what authority the person gives Capital Q in their latest words, over their own onboarding: choices they hand over for Q to make now, and Q's pending recommendations they approve.

- Handing over a choice is an instruction: they give the choice to Q and want it made, not discussed. Asking what is usual or typical, asking for advice, suggestions or options to consider, asking any question, or giving their own answer hands nothing over.
- For each choice handed over, give the one step it belongs to, from the steps listed: the step whose question and meaning are the most plausible reading of what they asked for. Read each step's meaning, not only its question: where two steps ask about similar things with different force, choose the one whose meaning matches the force of their words; where one step covers the general case and another only a narrower kind of thing (sectors, countries, stages), choose the narrower one only when their words are about that kind of thing.
- Approving is agreeing, now, to a specific recommendation listed as pending. Words about something else approve nothing; a new instruction is not an approval of an earlier recommendation.
- What Q said just before is context for what they refer to; only the person's latest words can hand anything over or approve anything.
- Nothing handed over or approved: empty lists.

STEPS (trusted; the journey's own questions and what an answer means)
{{steps}}

PENDING RECOMMENDATIONS (trusted; what Q recommended and is waiting on)
{{pending}}

Everything between the UNTRUSTED_CONTENT markers is what was said.

WHAT Q SAID JUST BEFORE
{{lastQ}}
THEIR LATEST WORDS
{{utterance}}

Respond with a single JSON object {"delegated": [{"stepKey": "..."}], "approved": [{"stepKey": "..."}]}.`;

export const DELEGATION_READER_V1: PromptDefinition<
  DelegationReaderVariables,
  DelegationReaderResult
> = {
  id: "DELEGATION_READER",
  version: 1,
  status: "DEPRECATED",
  kind: "TASK",
  taskClass: "FAST_CLASSIFICATION",
  owner: "q-core",
  changeDescription:
    "Lead 2026-09-25: the authority a person gives Q in a turn — choices handed over, recommendations approved — is read once, independently of the acting model; code permits a delegated or accepted write only for those steps, and the interview is told them as trusted input.",
  effectiveFrom: "2026-09-25",
  variables: {
    schema: DelegationReaderVariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: DELEGATION_READER_SCHEMA_NAME,
    schemaVersion: DELEGATION_READER_SCHEMA_VERSION,
    schema: DelegationReaderResultSchema,
  },
  template: TEMPLATE,
};
