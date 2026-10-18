import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V34 } from "./turn-reader.v34.js";

/**
 * TURN_READER v35 -- v34 plus one rule (parity eval 2026-10-02, runs
 * 9a63392f / e445cfb9): "We've decided not to proceed with Ledgerfold for
 * now." was read as ANSWER with no action, and nothing was prepared. A
 * decision a person states about one of their own relationships (not
 * proceeding, pausing, resuming, diligence, what a meeting led to) is a
 * request for relationship_outcome, which prepares it for their approval; an
 * opinion or a doubt is not. Same schema and order as v34; the new words sit
 * in the static prefix.
 */
const V34_TOOL_REQUEST =
  "- TOOL_REQUEST: they ask Q to do something — open a page, change a detail, prepare a document, start or stop something.";
const V35_TOOL_REQUEST = `${V34_TOOL_REQUEST} A decision they state about one of their own relationships is a TOOL_REQUEST for relationship_outcome, even said as news ("we've decided not to proceed with Ledgerfold for now", "let's pause things with Ledgerfold", "we're starting diligence with Ledgerfold", "the call went well, we'll meet again"); an opinion, a doubt or a question is not ("I'm not sure about Ledgerfold", "should we pass?").`;
const V34_APP_ACTION_KINDS =
  "(save, unsave, pass or unpass a company; who may play their pitch video; who may see their fund or investor organisation)";
const V35_APP_ACTION_KINDS =
  "(save, unsave, pass or unpass a company; who may play their pitch video; who may see their fund or investor organisation; a decision they state about one of their relationships: not proceeding, pausing, resuming, what a meeting led to)";

for (const anchor of [V34_TOOL_REQUEST, V34_APP_ACTION_KINDS]) {
  if (TURN_READER_V34.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v35 edits v34 once, which lost: ${anchor}`);
  }
}

export const TURN_READER_V35: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V34,
  version: 35,
  status: "DEPRECATED",
  changeDescription:
    "Parity eval 2026-10-02 (runs 9a63392f, e445cfb9): a decision stated about one of their own relationships is a TOOL_REQUEST for relationship_outcome; an opinion or doubt is not. Same schema and order as v34.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V34.template
    .replace(V34_TOOL_REQUEST, V35_TOOL_REQUEST)
    .replace(V34_APP_ACTION_KINDS, V35_APP_ACTION_KINDS),
};
