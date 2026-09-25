import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_SCHEMA_NAME,
  DELEGATION_READER_UNTRUSTED,
  DELEGATION_READER_V2_SCHEMA_VERSION,
  DelegationReaderV2ResultSchema,
  DelegationReaderV2VariablesSchema,
  type DelegationReaderV2Result,
  type DelegationReaderV2Variables,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V1 } from "./delegation-reader.v1.js";

/**
 * DELEGATION_READER v2 — what the person's latest words establish about
 * their own onboarding: what they state about themselves, what they
 * decline, what they hand to Q, what they approve, and whether they want
 * to finish (ACC 2026-09-25). Concepts only, none keyed to a phrase.
 */
const TEMPLATE = `TASK: DELEGATION_READER
Read what the person's latest words establish about their own onboarding. Capital Q records nothing that this reading does not support.

- Stated: the steps whose answer their latest words give, change or take back, as a statement about themselves — their own investing, company, circumstances or preferences. Answering the question Q just asked, or confirming a value Q just read back to them, states that step. A question (even one that mentions a place, a sector, a stage or an amount), a request for advice or for what is usual, talk about the market or other people, and anything hypothetical state nothing. A step is stated only when their words give its answer, not when they merely touch its subject.
- Declined: the optional steps they decline to answer — they say they have no preference, nothing applies, or they would rather not say — as their answer, not as a question. Required steps are never declined.
- Handed over: the steps whose choice they give to Q and want made now, not discussed; asking what is usual, for advice or for suggestions hands nothing over. For each, the one step that is the most plausible reading: read each step's meaning, not only its question; where two steps differ in force, the one that matches the force of their words; where one covers the general case and another only a narrower kind of thing (sectors, countries, stages), the narrower one only when their words are about that kind of thing.
- Approved: the pending recommendations listed below that they agree to, now. Words about something else approve nothing.
- Finishing: true only when they confirm that what is on the record is right and want to finish now.
- What Q said just before is context for what their words refer to; only their latest words count. Nothing of a kind: an empty list, or false.

STEPS (trusted; the journey's own questions, what an answer means, and whether it is required)
{{steps}}

PENDING RECOMMENDATIONS (trusted; what Q recommended and is waiting on)
{{pending}}

Everything between the UNTRUSTED_CONTENT markers is what was said.

WHAT Q SAID JUST BEFORE
{{lastQ}}
THEIR LATEST WORDS
{{utterance}}

Respond with a single JSON object {"stated": [{"stepKey": "..."}], "declined": [{"stepKey": "..."}], "delegated": [{"stepKey": "..."}], "approved": [{"stepKey": "..."}], "finishing": false}.`;

export const DELEGATION_READER_V2: PromptDefinition<
  DelegationReaderV2Variables,
  DelegationReaderV2Result
> = {
  id: DELEGATION_READER_V1.id,
  version: 2,
  status: "ACTIVE",
  kind: "TASK",
  taskClass: "FAST_CLASSIFICATION",
  owner: "q-core",
  changeDescription:
    "ACC 2026-09-25: the reading covers what the person's latest words state about themselves, decline and decide to finish, besides what they hand over and approve; a stated write is permitted only for a step read as stated, so a question or an advisory mention never becomes an answer.",
  effectiveFrom: "2026-09-25",
  variables: {
    schema: DelegationReaderV2VariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: DELEGATION_READER_SCHEMA_NAME,
    schemaVersion: DELEGATION_READER_V2_SCHEMA_VERSION,
    schema: DelegationReaderV2ResultSchema,
  },
  template: TEMPLATE,
};
