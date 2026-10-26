import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V69_SCHEMA_VERSION,
  TurnReaderV65ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV65Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V68, V68_ONLY_WHAT_APPLIES } from "./turn-reader.v68.js";

/**
 * v69 (coordinator 2026-10-26, run 7b51d28d): with optional fields, "How
 * investor-ready is my company right now?" was read with nextSteps written
 * inside question, refused twice by the schema (question takes no other
 * key) and asked a third time (~3.5 s). Each field is written only where
 * the schema puts it; the reading's own fields are never nested. Same
 * output schema, strict as before.
 */
export const V69_FIELDS_WHERE_THEY_BELONG = `Every field goes only where the schema defines it. question holds only its own fields (kind, text, about, count, discover, subject, excludeShown); the reading's own fields -- nextSteps, fromShown, compare, aboutNamedOther, discoverWhom, askedAction, appAction, replyTo and the rest -- are written at the top level of the object, beside question, never inside question, tool or any other field.`;

if (TURN_READER_V68.template.split(V68_ONLY_WHAT_APPLIES).length !== 2) {
  throw new Error(
    "TURN_READER v69 extends v68's only-what-applies line, which changed",
  );
}

export const TURN_READER_V69: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV65Result
> = {
  ...TURN_READER_V68,
  version: 69,
  status: "ACTIVE",
  changeDescription:
    "Coordinator 2026-10-26 (run 7b51d28d): v68 plus FIELDS WHERE THEY BELONG -- question holds only its own fields, and the reading's own fields (nextSteps, fromShown, compare and the rest) are written at the top level, never nested; nextSteps inside question was refused twice by the schema. Same output schema, strict as before.",
  effectiveFrom: "2026-10-26",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V69_SCHEMA_VERSION,
    schema: TurnReaderV65ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V68.template.replace(
    V68_ONLY_WHAT_APPLIES,
    `${V68_ONLY_WHAT_APPLIES} ${V69_FIELDS_WHERE_THEY_BELONG}`,
  ),
};
