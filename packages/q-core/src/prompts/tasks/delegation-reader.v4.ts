import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_UNTRUSTED,
  DelegationReaderV4VariablesSchema,
  type DelegationReaderV3Result,
  type DelegationReaderV4Variables,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V3 } from "./delegation-reader.v3.js";

/**
 * DELEGATION_READER v4 — v3, told which step Q was asking (founder live
 * test 2026-09-30). A short "yep" to "Nixo, right?" and a "yes" to the
 * review were read as stating nothing, so the answer was refused four
 * times and the review asked twice; and "you find it" about their own
 * website was read as neither a look-up nor anything else. The reading
 * stays a concept, never a word list: code supplies only the step key.
 */
const RULES_ANCHOR =
  "- What Q said just before is context for what their words refer to;";

const V4_RULES = `- The step Q was asking is named below. Their answer to it states that step even when it is short: agreeing to or correcting what Q read back for it ("Nixo, right?" "yep"), or answering its question in a word. Agreeing to Q's read-back of the whole record, when that step is a review, also states it and is finishing.
- Asking Q to find their own answer from public sources (their website, their company's details) is a look-up in their words, not a decline.
`;

const STEPS_ANCHOR =
  "PENDING RECOMMENDATIONS (trusted; what Q recommended and is waiting on)";
const ASKED_SECTION = `THE STEP Q WAS ASKING (trusted; null when none)
{{askedStep}}

`;

for (const anchor of [RULES_ANCHOR, STEPS_ANCHOR]) {
  if (!DELEGATION_READER_V3.template.includes(anchor)) {
    throw new Error("DELEGATION_READER v4 extends v3, which lost an anchor");
  }
}

export const DELEGATION_READER_V4: PromptDefinition<
  DelegationReaderV4Variables,
  DelegationReaderV3Result
> = {
  ...DELEGATION_READER_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-30: the reader is told which step Q was asking, so a short yes or correction to a read-back states that step (and a yes to the review is finishing); asking Q to find their own answer is a look-up.",
  effectiveFrom: "2026-09-30",
  variables: {
    schema: DelegationReaderV4VariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  template: DELEGATION_READER_V3.template
    .replace(RULES_ANCHOR, `${V4_RULES}${RULES_ANCHOR}`)
    .replace(STEPS_ANCHOR, `${ASKED_SECTION}${STEPS_ANCHOR}`),
};
