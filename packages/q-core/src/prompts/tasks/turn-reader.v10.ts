import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V9_SCHEMA_VERSION,
  TurnReaderV9ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV9Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V9 } from "./turn-reader.v9.js";

/**
 * TURN_READER v10 — v9, plus the Relationships screen (R27, founder
 * 2026-09-26): a top-level page listing every company-investor
 * relationship of the person's side. "Take me to my relationships" is
 * NAVIGATE RELATIONSHIPS, not an unknown screen. Same output schema as
 * v9; the destination enum (contracts) already names it.
 */
const V9_LAST_DESTINATION =
  "COMPANY_VISIBILITY (their company's visibility or discovery settings).";

const V10_LAST_DESTINATIONS =
  "COMPANY_VISIBILITY (their company's visibility or discovery settings), RELATIONSHIPS (their relationships: the companies or investors they are in touch with, interest expressed, connections).";

if (!TURN_READER_V9.template.includes(V9_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v10 extends v9's NAVIGATE destinations, which v9 lost",
  );
}

export const TURN_READER_V10: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV9Result
> = {
  ...TURN_READER_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "R27: the Relationships page is a NAVIGATE destination (RELATIONSHIPS).",
  effectiveFrom: "2026-09-27",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V9_SCHEMA_VERSION,
    schema: TurnReaderV9ResultSchema,
  },
  template: TURN_READER_V9.template.replace(
    V9_LAST_DESTINATION,
    V10_LAST_DESTINATIONS,
  ),
};
