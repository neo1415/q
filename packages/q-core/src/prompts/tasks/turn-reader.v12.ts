import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V11_SCHEMA_VERSION,
  TurnReaderV11ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV11Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V11 } from "./turn-reader.v11.js";

/**
 * TURN_READER v12 — v11, plus the Saved screen (R30 #7): the companies an
 * investor saved from Discover. "Show me what I saved" is NAVIGATE SAVED,
 * not an unknown screen. Same output schema as v11; the destination enum
 * (contracts) already names it.
 */
const V11_LAST_DESTINATION =
  "RELATIONSHIPS (their relationships: the companies or investors they are in touch with, interest expressed, connections).";

const V12_LAST_DESTINATIONS =
  "RELATIONSHIPS (their relationships: the companies or investors they are in touch with, interest expressed, connections), SAVED (their Saved list: companies they saved from Discover to come back to; saving is not interest).";

if (!TURN_READER_V11.template.includes(V11_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v12 extends v11's NAVIGATE destinations, which v11 lost",
  );
}

export const TURN_READER_V12: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV11Result
> = {
  ...TURN_READER_V11,
  version: 12,
  status: "DEPRECATED",
  changeDescription:
    "R30 #7: the Saved page is a NAVIGATE destination (SAVED).",
  effectiveFrom: "2026-09-27",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V11_SCHEMA_VERSION,
    schema: TurnReaderV11ResultSchema,
  },
  template: TURN_READER_V11.template.replace(
    V11_LAST_DESTINATION,
    V12_LAST_DESTINATIONS,
  ),
};
