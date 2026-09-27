import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V9_SCHEMA_VERSION,
  TurnReaderV9ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV9Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V8 } from "./turn-reader.v8.js";

/**
 * TURN_READER v9 — v8 (a named screen Capital Q does not have), with
 * several documents in one message and the person's own company left to
 * code (founder live 2026-09-27, failures 6 and 7).
 *
 * "A PDF of my mandate and a PPTX pitch deck for my company" made nothing
 * but a question: one tool per reading could not hold two documents, and
 * the deck's company was filled with a name the person had not said, so
 * code (rightly) refused to research it and asked "which company?". v9
 * lists every document asked for, and leaves subjectName null whenever the
 * person means their own company, however they refer to it: code knows
 * whose company that is. Concepts only.
 */
const V8_OWN_COMPANY = "null only when that is plainly their own company.";
const V9_OWN_COMPANY =
  "null when they mean their own company or themselves, however they refer to it, even when you know its name: Capital Q knows whose company that is.";

const V8_PREPARE_TAIL =
  "Changing a document Q already made is not this. All other parameters null.";
const V9_PREPARE_TAIL = `${V8_PREPARE_TAIL} When one message asks for more than one document, tool is the first one asked for and moreDocuments holds each other one, in the order asked, each a PREPARE_DOCUMENT with its own documentType and subjectName; otherwise moreDocuments is empty.`;

for (const anchor of [V8_OWN_COMPANY, V8_PREPARE_TAIL]) {
  if (!TURN_READER_V8.template.includes(anchor)) {
    throw new Error(`TURN_READER v9 extends v8, which lost: ${anchor}`);
  }
}

export const TURN_READER_V9: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV9Result
> = {
  ...TURN_READER_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-27: v8's unknown-screen rule, plus every document asked for in one message is read (moreDocuments), and subjectName stays null whenever the person means their own company, however they refer to it.",
  effectiveFrom: "2026-09-27",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V9_SCHEMA_VERSION,
    schema: TurnReaderV9ResultSchema,
  },
  template: TURN_READER_V8.template
    .replace(V8_OWN_COMPANY, V9_OWN_COMPANY)
    .replace(V8_PREPARE_TAIL, V9_PREPARE_TAIL),
};
