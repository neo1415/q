import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_UNTRUSTED,
  DelegationReaderV4VariablesSchema,
  type DelegationReaderV3Result,
  type DelegationReaderV4Variables,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V6 } from "./delegation-reader.v6.js";

/**
 * DELEGATION_READER v7 — v6, with finishing read as the owner defined it
 * (2026-10-28: "that's all" is finishing). Production re-test 2026-10-28
 * (sessions 38916a94, f46ddb69): a founder's and an investor's "that's
 * all" were read as finishing nothing, because v2 reserved finishing for
 * confirming the record; the founder's was then saved as the answer to the
 * open question, and the investor's named nothing still open. Concepts,
 * with examples; the reading stays the model's (DECISIONS 40).
 */
const V6_FINISHING_RULE =
  "- Finishing: true only when they confirm that what is on the record is right and want to finish now.";

const V7_FINISHING_RULE =
  '- Finishing: true when they want the setup wrapped up now: they say they are done or have nothing more to add ("that\'s all", "that\'s everything for now"), ask to finish, or confirm that what is on the record is right and want to finish. Finishing is not pausing: pausing is leaving to come back to it later. Words that only finish, pause, skip, or ask Q something answer no question: they state nothing, not even the step Q was asking.';

if (!DELEGATION_READER_V6.template.includes(V6_FINISHING_RULE)) {
  throw new Error("DELEGATION_READER v7 extends v6, which lost an anchor");
}

export const DELEGATION_READER_V7: PromptDefinition<
  DelegationReaderV4Variables,
  DelegationReaderV3Result
> = {
  ...DELEGATION_READER_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Production re-test 2026-10-28: \"that's all\" is finishing (owner); finishing, pausing, skipping or asking states no step's answer.",
  effectiveFrom: "2026-10-28",
  variables: {
    schema: DelegationReaderV4VariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  template: DELEGATION_READER_V6.template.replace(
    V6_FINISHING_RULE,
    V7_FINISHING_RULE,
  ),
};
