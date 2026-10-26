import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V66_SCHEMA_VERSION,
  TurnReaderV65ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV65Result,
} from "../schemas/turn-reader.js";
import { V58_RAISING } from "./turn-reader.v58.js";
import { TURN_READER_V65 } from "./turn-reader.v65.js";

/**
 * v66 (QA F-114, coordinator 2026-10-25): Q's Discover filters added
 * Verified, Has pitch video and Raise shared nobody asked for, and the
 * page showed no companies. Code now drops those three unless the reading
 * carries them; this asks the reader for them, so "only verified fintechs
 * in Kenya" keeps verifiedOnly. The live v65 is kept whole; same output
 * schema (the discover structure's new fields default to false).
 */
export const V66_DISCOVER_QUALIFIERS = `verifiedOnly, hasPitch, raiseShared: true only when they themselves ask for that narrowing, in any words and any language -- verifiedOnly for verified companies only ("only verified ones"), hasPitch for companies with a pitch video ("only those with a pitch video"), raiseShared for companies that share their raise details ("only ones that disclose their raise"); false otherwise. Raising now is raising, never raiseShared.`;

if (TURN_READER_V65.template.split(V58_RAISING).length !== 2) {
  throw new Error("TURN_READER v66 extends v58's raising rule, which changed");
}

export const TURN_READER_V66: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV65Result
> = {
  ...TURN_READER_V65,
  version: 66,
  status: "DEPRECATED",
  changeDescription:
    "QA F-114 (coordinator 2026-10-25): v65 plus verifiedOnly, hasPitch and raiseShared in the discover structure, true only when the person asks for that narrowing, by meaning in any language; code keeps those Discover filters only when read, and drops them when only the model added them. Same output schema.",
  effectiveFrom: "2026-10-25",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V66_SCHEMA_VERSION,
    schema: TurnReaderV65ResultSchema,
  },
  template: TURN_READER_V65.template.replace(
    V58_RAISING,
    `${V58_RAISING} ${V66_DISCOVER_QUALIFIERS}`,
  ),
};
