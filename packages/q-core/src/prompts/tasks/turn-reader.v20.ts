import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V19 } from "./turn-reader.v19.js";

/**
 * TURN_READER v20 -- v19, plus Documents (DOCS, founder directive
 * 2026-10-01): every document Q made for them and their brand kit. Same
 * output schema; whether this person may open a screen is still decided
 * by the navigate capability, not here.
 */
const V19_LAST_DESTINATION =
  "REHEARSALS (Rehearsals: rehearse a meeting with someone they are connected to, played by Q, and their past rehearsals with reviews).";

const V20_LAST_DESTINATIONS =
  "REHEARSALS (Rehearsals: rehearse a meeting with someone they are connected to, played by Q, and their past rehearsals with reviews), DOCUMENTS (their documents: every deck, brief and report Q made for them, to open or download, and their brand kit: logo, colours and fonts).";

if (!TURN_READER_V19.template.includes(V19_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v20 extends v19's NAVIGATE destinations, which v19 lost",
  );
}

export const TURN_READER_V20: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V19,
  version: 20,
  status: "ACTIVE",
  changeDescription:
    "DOCS 2026-10-01: Documents (their documents and brand kit) is a destination.",
  effectiveFrom: "2026-10-01",
  template: TURN_READER_V19.template.replace(
    V19_LAST_DESTINATION,
    V20_LAST_DESTINATIONS,
  ),
};
