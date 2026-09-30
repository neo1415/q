import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_SCHEMA_NAME,
  DELEGATION_READER_V3_SCHEMA_VERSION,
  DelegationReaderV3ResultSchema,
  type DelegationReaderV2Variables,
  type DelegationReaderV3Result,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V2 } from "./delegation-reader.v2.js";

/**
 * DELEGATION_READER v3 — v2, plus what the latest words ask of the
 * conversation itself (P0-1). The legacy conductor read these with its own
 * model and read a pause from a word list; here they are concepts, read
 * independently of the model that acts. Code decides what follows.
 */
const RULES_ANCHOR =
  "- What Q said just before is context for what their words refer to;";

const V3_RULES = `- Lookup: a question of theirs that needs looking something up beyond their own setup — Capital Q's records of other companies or investors, or public sources about a company, a market, a person or investors. Give the question in their words. A question about their own answers, about how Capital Q works, or one asking for Q's view or advice is not a lookup; null when there is none.
- Pausing: true only when they want to stop the conversation for now and come back to it later. Taking a moment to think, or asking to go back to a question, is not pausing.
- Pronounce: when they correct how Q says a name or term, the term as it is written and how it should be said, as they put it; null otherwise.
`;

const RESPOND_V2 = `Respond with a single JSON object {"stated": [{"stepKey": "..."}], "declined": [{"stepKey": "..."}], "delegated": [{"stepKey": "..."}], "approved": [{"stepKey": "..."}], "finishing": false}.`;
const RESPOND_V3 = `Respond with a single JSON object {"stated": [{"stepKey": "..."}], "declined": [{"stepKey": "..."}], "delegated": [{"stepKey": "..."}], "approved": [{"stepKey": "..."}], "finishing": false, "lookup": null, "pausing": false, "pronounce": null}.`;

for (const anchor of [RULES_ANCHOR, RESPOND_V2]) {
  if (!DELEGATION_READER_V2.template.includes(anchor)) {
    throw new Error("DELEGATION_READER v3 extends v2, which lost an anchor");
  }
}

export const DELEGATION_READER_V3: PromptDefinition<
  DelegationReaderV2Variables,
  DelegationReaderV3Result
> = {
  ...DELEGATION_READER_V2,
  version: 3,
  status: "DEPRECATED",
  changeDescription:
    "P0-1: the reading also covers a question that needs a look-up beyond their own setup, a wish to pause, and a pronunciation correction, as concepts; the legacy conductor's reading and word list are retired.",
  effectiveFrom: "2026-09-26",
  output: {
    kind: "STRUCTURED",
    schemaName: DELEGATION_READER_SCHEMA_NAME,
    schemaVersion: DELEGATION_READER_V3_SCHEMA_VERSION,
    schema: DelegationReaderV3ResultSchema,
  },
  template: DELEGATION_READER_V2.template
    .replace(RULES_ANCHOR, `${V3_RULES}${RULES_ANCHOR}`)
    .replace(RESPOND_V2, RESPOND_V3),
};
