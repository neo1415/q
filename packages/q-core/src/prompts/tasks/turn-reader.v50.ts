import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV49Result,
} from "../schemas/turn-reader.js";
import { V45_FIT } from "./turn-reader.v45.js";
import { TURN_READER_V49 } from "./turn-reader.v49.js";

/** The existing reader distinguishes a fit ranking from a compound question. */
export const V50_FIT = `${V45_FIT}FIT is only a request fully answered by the computed ranking, comparison and its fit reasons. When they also ask what Q learned, historical work, weaknesses, missing evidence or other analysis beyond that ranking, read the whole question as THEIR_OWN_RECORDS. Preserve every part in question.text; never reduce it to the ranking. For example, "Which companies fit my mandate and what did Q learn about them?" and "Which companies fit my mandate and what are their weaknesses?" are THEIR_OWN_RECORDS. A pure "Which companies fit my mandate and why?" remains FIT. This distinction is meaning, in any words or language, not a keyword test.\n`;

export const TURN_READER_V50: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV49Result
> = {
  ...TURN_READER_V49,
  version: 50,
  status: "DEPRECATED",
  changeDescription:
    "Compound mandate questions retain all requested analysis through the existing own-record answer path; ranking-only FIT keeps its deterministic shortcut.",
  effectiveFrom: "2026-10-13",
  template: TURN_READER_V49.template.replace(V45_FIT, V50_FIT),
};
