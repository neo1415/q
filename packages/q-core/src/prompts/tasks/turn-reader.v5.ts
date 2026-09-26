import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V5_SCHEMA_VERSION,
  TurnReaderV5ResultSchema,
  type TurnReaderV5Result,
  type TurnReaderVariables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V4, V4_PREPARE } from "./turn-reader.v4.js";

/**
 * TURN_READER v5 — v4, with a document about the person's OWN investment
 * mandate (gap 3, ACC 2026-09-25): "give me my mandate / thesis as a PDF"
 * was read as a deck about some company, then answered "which company?".
 * Concepts only.
 */
const V5_PREPARE = `- PREPARE_DOCUMENT: they want Capital Q to produce a document now. documentType PITCH_DECK (a presentation of a company for investors, in any format), INVESTMENT_BRIEF (a short written summary of a company for an investor), or OWN_MANDATE (a document of their own investment mandate or thesis: what they themselves invest in, as they declared it). subjectName: for PITCH_DECK and INVESTMENT_BRIEF, the company the document is about — the one this message names, otherwise the most recent company the conversation was explicitly about; null only when that is plainly their own company. For OWN_MANDATE, null. It is PREPARE_DOCUMENT, and the kind is TOOL_REQUEST, whatever sources they want it built from, whether they ask for a finished document, a sample or a draft, and however they phrase it. Asking what a document would contain, or how Q makes one, is a question, not this. Changing a document Q already made is not this. All other parameters null.
`;

if (!TURN_READER_V4.template.includes(V4_PREPARE)) {
  throw new Error(
    "TURN_READER v5 restates v4's PREPARE_DOCUMENT rule, and v4 no longer carries it",
  );
}

export const TURN_READER_V5: PromptDefinition<
  TurnReaderVariables,
  TurnReaderV5Result
> = {
  ...TURN_READER_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "Gap 3: PREPARE_DOCUMENT gains OWN_MANDATE, a document of the person's own investment mandate or thesis built from their record; subjectName null for it.",
  effectiveFrom: "2026-09-26",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V5_SCHEMA_VERSION,
    schema: TurnReaderV5ResultSchema,
  },
  template: TURN_READER_V4.template.replace(V4_PREPARE, V5_PREPARE),
};
