import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV3Result,
  TurnReaderVariables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V3 } from "./turn-reader.v3.js";

/**
 * TURN_READER v4 — v3, with PREPARE_DOCUMENT stated as concepts (P0-1
 * prompt audit; lead instruction 2026-09-25).
 *
 * v3 keyed the document's subject to quoted phrases a person might use
 * and listed words for each document type. A reader keyed to wording
 * understands only the sentences somebody has already met (ADR 0011).
 * v4 says what the concepts are: each document type by what it is, and
 * the subject as the conversation's most recent explicit subject.
 */
const V3_PREPARE = /- PREPARE_DOCUMENT: [^\n]*\n/;

export const V4_PREPARE = `- PREPARE_DOCUMENT: they want Capital Q to produce a document now. documentType PITCH_DECK (a presentation of a company for investors, in any format) or INVESTMENT_BRIEF (a short written summary of a company for an investor). subjectName: the company the document is about — the one this message names, otherwise the most recent company the conversation was explicitly about; null only when that is plainly their own company. It is PREPARE_DOCUMENT, and the kind is TOOL_REQUEST, whatever sources they want it built from, whether they ask for a finished document, a sample or a draft, and however they phrase it. Asking what a document would contain, or how Q makes one, is a question, not this. Changing a document Q already made is not this. All other parameters null.
`;

if (!V3_PREPARE.test(TURN_READER_V3.template)) {
  throw new Error(
    "TURN_READER v4 restates v3's PREPARE_DOCUMENT rule, and v3 no longer carries it",
  );
}

export const TURN_READER_V4: PromptDefinition<
  TurnReaderVariables,
  TurnReaderV3Result
> = {
  ...TURN_READER_V3,
  version: 4,
  status: "DEPRECATED",
  changeDescription:
    "P0-1 prompt audit: PREPARE_DOCUMENT stated as concepts — each document type by what it is, and the subject as the conversation's most recent explicit subject — instead of quoted phrases.",
  effectiveFrom: "2026-09-25",
  template: TURN_READER_V3.template.replace(V3_PREPARE, V4_PREPARE),
};
