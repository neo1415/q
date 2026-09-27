import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V8_SCHEMA_VERSION,
  TurnReaderV8ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV8Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V7 } from "./turn-reader.v7.js";

/**
 * TURN_READER v8 — v7, plus a screen Capital Q does not have (founder live
 * test 2026-09-27 #5). "Take me to the queue page" was read as NAVIGATE
 * HOME under v6's "leave the choice to Capital Q" rule, and the person was
 * moved Home silently. A named screen that is none of the destinations is
 * now NAVIGATE with destination null and unknownScreen (what they called
 * it, and the nearest destination); code tells them it doesn't exist and
 * offers the nearest. Concepts only; no word lists.
 */
const V7_NAVIGATE_TAIL =
  "Asking what a screen is, or about something on it, is a question, not NAVIGATE.";

const V8_NAVIGATE_TAIL = `When they name a screen or page that is none of these destinations (Capital Q has no such screen), it is still NAVIGATE, but destination is null and unknownScreen is set: named, the screen as they called it (a few words), and nearest, the destination above closest to what they meant. Never choose a destination for a screen that does not exist. unknownScreen is null in every other case, and for every other tool. ${V7_NAVIGATE_TAIL}`;

if (!TURN_READER_V7.template.includes(V7_NAVIGATE_TAIL)) {
  throw new Error("TURN_READER v8 extends v7's NAVIGATE rule, which v7 lost");
}

export const TURN_READER_V8: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV8Result
> = {
  ...TURN_READER_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Founder live test 2026-09-27 #5: a named screen Capital Q does not have is NAVIGATE with destination null and unknownScreen (named, nearest); never a silent move to another screen.",
  effectiveFrom: "2026-09-27",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V8_SCHEMA_VERSION,
    schema: TurnReaderV8ResultSchema,
  },
  template: TURN_READER_V7.template.replace(V7_NAVIGATE_TAIL, V8_NAVIGATE_TAIL),
};
