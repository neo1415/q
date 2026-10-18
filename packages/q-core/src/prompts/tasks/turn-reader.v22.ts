import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V22_SCHEMA_VERSION,
  TurnReaderV22ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV22Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V21 } from "./turn-reader.v21.js";

/**
 * TURN_READER v22 -- v21, plus a hand-over (founder live 2026-10-01): the
 * person asks Q to get them a meeting with someone, or to take a
 * relationship over. Read from meaning in any language; code then
 * prepares Q's errand for the subject on their screen, for approval.
 */
export const TURN_READER_V22_HAND_OVER = `HAND OVER: handOver is set when they ask YOU to get them a meeting or call with someone (kind MEETING), or to take over, look after or handle a relationship or a person for them (kind HAND_OVER), in any words and any language. counterpartName is who, as they named them, or null when they point instead of naming (this person, them, this company, here). A question about meetings, a request to explain or prepare something, or talk about someone without asking you to act is not a hand-over: null.
`;

const V21_TRANSCRIPT_ANCHOR = "TRANSCRIPT (modality {{modality}}):";

if (!TURN_READER_V21.template.includes(V21_TRANSCRIPT_ANCHOR)) {
  throw new Error(
    "TURN_READER v22 adds its line before v21's transcript line, which v21 lost",
  );
}

export const TURN_READER_V22: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV22Result
> = {
  ...TURN_READER_V21,
  version: 22,
  status: "DEPRECATED",
  changeDescription:
    "Founder live 2026-10-01: handOver (MEETING / HAND_OVER, any language) so code prepares Q's errand for the subject on screen instead of the answer asking who.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V22_SCHEMA_VERSION,
    schema: TurnReaderV22ResultSchema,
  },
  template: TURN_READER_V21.template.replace(
    V21_TRANSCRIPT_ANCHOR,
    `${TURN_READER_V22_HAND_OVER}${V21_TRANSCRIPT_ANCHOR}`,
  ),
};
