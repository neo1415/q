import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V20 } from "./turn-reader.v20.js";

/**
 * TURN_READER v21 -- v20, plus The Q Daily (DAILY, founder directive
 * 2026-10-01): their personal newspaper and its archive. Same output
 * schema; whether this person may open a screen is still decided by the
 * navigate capability, not here.
 */
const V20_LAST_DESTINATION =
  "DOCUMENTS (their documents: every deck, brief and report Q made for them, to open or download, and their brand kit: logo, colours and fonts).";

const V21_LAST_DESTINATIONS =
  "DOCUMENTS (their documents: every deck, brief and report Q made for them, to open or download, and their brand kit: logo, colours and fonts), DAILY (The Q Daily: their own newspaper of news about their sectors, markets, deals and people they know, today's or this week's edition and its archive).";

if (!TURN_READER_V20.template.includes(V20_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v21 extends v20's NAVIGATE destinations, which v20 lost",
  );
}

export const TURN_READER_V21: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V20,
  version: 21,
  status: "DEPRECATED",
  changeDescription:
    "DAILY 2026-10-01: The Q Daily (their newspaper and archive) is a destination.",
  effectiveFrom: "2026-10-01",
  template: TURN_READER_V20.template.replace(
    V20_LAST_DESTINATION,
    V21_LAST_DESTINATIONS,
  ),
};
