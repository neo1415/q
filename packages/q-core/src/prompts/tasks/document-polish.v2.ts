import type { PromptDefinition } from "../definition.js";
import {
  DOCUMENT_POLISH_SCHEMA_NAME,
  DOCUMENT_POLISH_V2_SCHEMA_VERSION,
  DocumentPolishV2ResultSchema,
  type DocumentPolishV2Result,
  type DocumentPolishVariables,
} from "../schemas/document-polish.js";
import { DOCUMENT_POLISH_V1 } from "./document-polish.v1.js";

/**
 * DOCUMENT_POLISH v2 (live 2026-10-07, wave 5b).
 *
 * The first live deck shipped unpolished: one bullet over 180 characters
 * refused the whole rewrite, and the slides kept the record's narrator
 * voice ("is described as", "the deck estimates"). v2 states the voice
 * (the company's own, first person, facts unchanged) and the lengths as
 * targets; its wire schema no longer refuses a long line (the caller
 * trims it), so one long field cannot discard the rest.
 */
const V1_LENGTH =
  "- A bullet stays one line: at most 180 characters, ideally under 90. Do not merge or split bullets; return the same number you were given.";

const V2_VOICE_AND_LENGTH = `- Write in the company's own voice, as its founder presenting: "we" and "our", or the company's name. Never narrate the deck or the record: no "is described as", "the deck estimates", "the company states", "according to the deck". "The deck estimates the market at X" becomes "We estimate the market at X". The fact, its figure and any qualifier stay exactly as they were.
- A content slide's title is a headline of at most 8 words (under 60 characters).
- A bullet is one short line: under 90 characters, never more than 160. Do not merge or split bullets; return the same number you were given.`;

if (!DOCUMENT_POLISH_V1.template.includes(V1_LENGTH)) {
  throw new Error(
    "DOCUMENT_POLISH v2 replaces v1's length rule, which v1 lost",
  );
}

export const DOCUMENT_POLISH_V2: PromptDefinition<
  DocumentPolishVariables,
  DocumentPolishV2Result
> = {
  ...DOCUMENT_POLISH_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Live 2026-10-07: the company's own voice (no narrator phrasing), headline titles and short bullets stated as targets; the wire schema accepts long lines so one long field no longer discards the whole rewrite (the caller trims at a word boundary).",
  effectiveFrom: "2026-10-07",
  output: {
    kind: "STRUCTURED",
    schemaName: DOCUMENT_POLISH_SCHEMA_NAME,
    schemaVersion: DOCUMENT_POLISH_V2_SCHEMA_VERSION,
    schema: DocumentPolishV2ResultSchema,
  },
  template: DOCUMENT_POLISH_V1.template.replace(V1_LENGTH, V2_VOICE_AND_LENGTH),
};
