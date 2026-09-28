import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V14_SCHEMA_VERSION,
  TurnReaderV14ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV14Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V13 } from "./turn-reader.v13.js";

/**
 * TURN_READER v14 — v13, plus any answer as a document (founder live
 * 2026-09-28 #1). "A PDF of an assessment of how I come across" fitted no
 * document type, so Q said it could not make a PDF although it can.
 * ANSWER_EXPORT files the answer Q already gave, as written; Q_REPORT is a
 * new written answer Q writes and then files. Whether a document is made
 * is still decided by the capability registry, not here.
 */
const V13_DOCUMENT_TYPES =
  "or OWN_MANDATE (a document of their own investment mandate or thesis: what they themselves invest in, as they declared it).";

const V14_DOCUMENT_TYPES =
  'OWN_MANDATE (a document of their own investment mandate or thesis: what they themselves invest in, as they declared it), ANSWER_EXPORT (an answer Capital Q already gave in this conversation, as a document or PDF, as it stands: "put that in a PDF", "can I download your last answer"), or Q_REPORT (any other written piece they want as a document or PDF, which Capital Q writes now: an assessment, an analysis, a summary, notes, a comparison, a plan; anything that is not a deck, a brief or their mandate). A document or PDF is never refused for being of an unusual kind: what is not one of the others is Q_REPORT.';

const V13_SUBJECT_NULL = "For OWN_MANDATE, null.";
const V14_SUBJECT_NULL = "For OWN_MANDATE, ANSWER_EXPORT and Q_REPORT, null.";

for (const piece of [V13_DOCUMENT_TYPES, V13_SUBJECT_NULL]) {
  if (!TURN_READER_V13.template.includes(piece)) {
    throw new Error(
      "TURN_READER v14 extends v13's document types, which v13 lost",
    );
  }
}

export const TURN_READER_V14: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV14Result
> = {
  ...TURN_READER_V13,
  version: 14,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-28 #1: PREPARE_DOCUMENT gains ANSWER_EXPORT (an answer already given, as a document) and Q_REPORT (any other written piece, written and filed as a document).",
  effectiveFrom: "2026-09-28",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V14_SCHEMA_VERSION,
    schema: TurnReaderV14ResultSchema,
  },
  template: TURN_READER_V13.template
    .replace(V13_DOCUMENT_TYPES, V14_DOCUMENT_TYPES)
    .replace(V13_SUBJECT_NULL, V14_SUBJECT_NULL),
};
