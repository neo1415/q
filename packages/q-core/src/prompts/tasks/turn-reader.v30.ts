import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V30_SCHEMA_VERSION,
  TurnReaderV30ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV30Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V28_DIRECT } from "./turn-reader.v28.js";
import { TURN_READER_V29 } from "./turn-reader.v29.js";

/**
 * TURN_READER v30 -- v29 plus askedAction (HARDEN, ADR 0040 parity,
 * 2026-10-02): the name of the listed action they asked for, so a turn
 * where Q did nothing is logged as "not called", "declared but not
 * available here" or "missing from the registry" by code, from names.
 */
export const TURN_READER_V30_ASKED_ACTION = `ASKED ACTION: askedAction is the name, exactly as written in the actions list above, of the one action that does what they asked for, whether or not it is marked not available in this conversation; null when they asked for nothing to be done or when none of the listed actions does it. Never a name that is not in the list.
`;

if (!TURN_READER_V29.template.includes(TURN_READER_V28_DIRECT)) {
  throw new Error("TURN_READER v30 extends v28's direct line, which changed");
}

export const TURN_READER_V30: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV30Result
> = {
  ...TURN_READER_V29,
  version: 30,
  status: "ACTIVE",
  changeDescription:
    "HARDEN 2026-10-02 (ADR 0040 parity): askedAction, the listed action's name that does what they asked, or null; actions not available in this run are listed and marked.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V30_SCHEMA_VERSION,
    schema: TurnReaderV30ResultSchema,
  },
  template: TURN_READER_V29.template.replace(
    TURN_READER_V28_DIRECT,
    `${TURN_READER_V28_DIRECT}${TURN_READER_V30_ASKED_ACTION}`,
  ),
};
