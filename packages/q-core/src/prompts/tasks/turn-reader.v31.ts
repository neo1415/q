import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V31_SCHEMA_VERSION,
  TurnReaderV31ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V30,
  TURN_READER_V30_ASKED_ACTION,
} from "./turn-reader.v30.js";

/**
 * TURN_READER v31 -- v30 plus appAction (QA, ADR 0040 parity eval,
 * 2026-10-02): the one declared app action a direct request asks for,
 * with its arguments as said, so code runs it instead of the answer model
 * describing it.
 */
export const TURN_READER_V31_APP_ACTION = `APP ACTION: appAction is set only for ONE direct, specific request that one of the listed actions does by itself (save, unsave, pass or unpass a company; who may play their pitch video): {"tool": the action's name exactly as listed, "arguments": its inputs, with every record named exactly as they said it, for example {"company": "Ajopot"} or {"pitch": "my pitch video", "sharing": "INVESTORS"}}. A request about a pitch or a video is this, never SET_VISIBILITY ("let investors play my pitch video" is set_pitch_sharing). Null for a question, a hand-over, a request of several steps, or one no listed action does.
`;

if (!TURN_READER_V30.template.includes(TURN_READER_V30_ASKED_ACTION)) {
  throw new Error(
    "TURN_READER v31 extends v30's asked-action line, which changed",
  );
}

export const TURN_READER_V31: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V30,
  version: 31,
  status: "ACTIVE",
  changeDescription:
    "QA 2026-10-02 (ADR 0040 parity eval): appAction, the one declared app action a direct request asks for with its arguments as said; a pitch or video's sharing is set_pitch_sharing, never SET_VISIBILITY.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V31_SCHEMA_VERSION,
    schema: TurnReaderV31ResultSchema,
  },
  template: TURN_READER_V30.template.replace(
    TURN_READER_V30_ASKED_ACTION,
    `${TURN_READER_V30_ASKED_ACTION}${TURN_READER_V31_APP_ACTION}`,
  ),
};
