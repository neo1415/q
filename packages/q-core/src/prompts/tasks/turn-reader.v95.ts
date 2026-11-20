import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V95_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV95ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV95Result,
} from "../schemas/turn-reader.js";
import { V92_RULES_END_BEFORE } from "./turn-reader.v92.js";
import { TURN_READER_V94, V94_CONTACT_STATUS } from "./turn-reader.v94.js";

/**
 * v95 (HQ-1, 20 Nov 2026; conversation audit §2.2): the answer's shape is
 * decided by code from the reading. Two fields are read by meaning:
 * `underspecified` and `costlyIfWrong`. One paragraph is added right after
 * v94's CONTACT STATUS, inside the fixed rules v92 sends as cacheable
 * instructions; the boundary is v92's. Same single reading.
 */
export const V95_ANSWER_PLAN = `ANSWER PLAN: underspecified is true when what they want, or who or what it is about, is unclear enough that you would have to guess -- read with RECENT TURNS, by meaning, in any language ("help me with investors", "what should I do?", "look into it" with nothing named before) -- and false when the ask and its subject are plain or the last turns make them plain. costlyIfWrong is true when acting on a wrong guess would waste real work or mislead them (a document, an outreach, a ranking or a decision they would act on), and false for a quick fact, small talk, or anything cheap to redo. Both are about form only: never leave out a reference, a part or a kind because of them.`;

if (TURN_READER_V94.template.split(V94_CONTACT_STATUS).length !== 2) {
  throw new Error(
    "TURN_READER v95 follows v94's CONTACT STATUS paragraph, which changed or repeats",
  );
}

export const TURN_READER_V95: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV95Result
> = {
  ...TURN_READER_V94,
  version: 95,
  status: "ACTIVE",
  changeDescription:
    "HQ-1 (20 Nov 2026, conversation audit 2.2): v94 plus one ANSWER PLAN paragraph -- underspecified and costlyIfWrong, read by meaning in any language; code picks the answer's shape from them and the kinds already read. Same rules boundary as v92; no extra model call.",
  effectiveFrom: "2026-11-20",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V95_SCHEMA_VERSION,
    schema: TurnReaderV95ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V94.template.replace(
    V94_CONTACT_STATUS,
    `${V94_CONTACT_STATUS}\n${V95_ANSWER_PLAN}`,
  ),
  rulesEndBefore: V92_RULES_END_BEFORE,
};
