import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV40Result,
  TurnReaderV7Variables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V42 } from "./turn-reader.v42.js";

/**
 * TURN_READER v43 -- NO FILE UNLESS ASKED (founder brief 2026-10-05, C5
 * and C9).
 *
 * Live at 14:46: "come up with three startups, put them side by side" was
 * read as PREPARE_DOCUMENT Q_REPORT, because v14 listed "a comparison"
 * among the pieces Q_REPORT writes and v4 said "however they phrase it".
 * Q answered, then filed the answer as a PDF nobody asked for. Seeing
 * something together is an answer Q shows on screen; a document is made
 * only when they ask for a file. The output schema is v40's.
 */
export const V42_PREPARE_HEAD =
  "- PREPARE_DOCUMENT: they want Capital Q to produce a document now.";
export const V43_PREPARE_HEAD =
  "- PREPARE_DOCUMENT: they ask for a file: a document, PDF, deck, brief or report, or something to download, print, attach or send, in their words or by accepting Q's offer of one. Wanting to see things (a list, a top N, a ranking, things side by side, a comparison, research) is ANSWER, never this: Q shows it on screen.";
export const V42_REPORT_EXAMPLES =
  "an assessment, an analysis, a summary, notes, a comparison, a plan;";
export const V43_REPORT_EXAMPLES =
  "an assessment, an analysis, a summary, notes, a plan, once asked for as a file;";

for (const anchor of [V42_PREPARE_HEAD, V42_REPORT_EXAMPLES]) {
  if (TURN_READER_V42.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v43 rewrites v42, which changed: ${anchor}`);
  }
}

export const TURN_READER_V43: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV40Result
> = {
  ...TURN_READER_V42,
  version: 43,
  status: "ACTIVE",
  changeDescription:
    "Founder brief 2026-10-05 (C5): PREPARE_DOCUMENT only when they ask for a file; wanting to see a list, top N, comparison or research is ANSWER, shown on screen as cards; Q_REPORT no longer lists a comparison.",
  effectiveFrom: "2026-10-05",
  template: TURN_READER_V42.template
    .replace(V42_PREPARE_HEAD, V43_PREPARE_HEAD)
    .replace(V42_REPORT_EXAMPLES, V43_REPORT_EXAMPLES),
};
