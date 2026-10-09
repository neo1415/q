import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V47_SCHEMA_VERSION,
  TurnReaderV47ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV47Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V46 } from "./turn-reader.v46.js";

/**
 * TURN_READER v47 -- PREPARED SUBJECTS (founder brief K8, 2026-10-09).
 *
 * "What is my mandate", "what company am I looking at" and "what have my
 * agents completed" are answered from what Capital Q already read for the
 * turn, with no tool round. The reader names that subject, in any words,
 * so the router can take the cheapest correct path; code never parses it
 * out of their words.
 */
export const V47_SUBJECT = `SUBJECT (for QUESTION_TO_Q; otherwise null): MANDATE when the question is about their own investment mandate or criteria as declared; ON_SCREEN_RECORD when it is about the company, investor or document they are looking at now ("what company am I looking at", "tell me about this one"); Q_WORK when it is about what Q or their agents are doing or have done for them. Null for anything else, and whenever the question needs more than that one thing (a comparison, advice, other companies).
`;

if (TURN_READER_V46.template.split("STILL WAITING:").length !== 2) {
  throw new Error(
    "TURN_READER v47 rewrites v46, which changed: STILL WAITING:",
  );
}

export const TURN_READER_V47: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV47Result
> = {
  ...TURN_READER_V46,
  version: 47,
  status: "DEPRECATED",
  changeDescription:
    "Founder brief K8: the reader names a question about a prepared subject (their mandate, the record on screen, Q's work) so it is answered from prepared context without a tool round.",
  effectiveFrom: "2026-10-09",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V47_SCHEMA_VERSION,
    schema: TurnReaderV47ResultSchema,
  },
  template: TURN_READER_V46.template.replace(
    "STILL WAITING:",
    `${V47_SUBJECT}STILL WAITING:`,
  ),
};
