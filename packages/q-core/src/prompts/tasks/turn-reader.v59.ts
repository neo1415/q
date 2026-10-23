import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV55Variables,
  TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V40_REFERENCES } from "./turn-reader.v40.js";
import { TURN_READER_V58 } from "./turn-reader.v58.js";

/**
 * v59 (coordinator live test 2026-10-23, run 1102eab6): after a cards
 * turn, "Draft a note to the founders of the second company saying I'd
 * like a call next week" was read as opening the second company, so code
 * opened its page and no note or Express Interest was ever prepared. Asking
 * Q to write, send or do something for a record's people is not asking to
 * open it: `open` stays null and `name`/`shown` still say which record, so
 * the turn reaches the answer with its tools (the message or email
 * proposal, and its first-contact fallback). v58 is kept whole; read by
 * meaning in any language; schema unchanged (v58).
 */
export const V59_ACT_ON_IS_NOT_OPEN = `- open is null when they ask Q to DO something for, to or about the record's people rather than to show the record: write, draft or send a note, message or email to its founders or team, express interest, ask for a call or a meeting, request a document, answer them. That is a request for Q to act, by what it means, in any language ("draft a note to the founders of the second company", "send the first one a message", "écris aux fondateurs de la deuxième"); name and shown still say which record it is.
`;

if (TURN_READER_V58.template.split(TURN_READER_V40_REFERENCES).length !== 2) {
  throw new Error(
    "TURN_READER v59 extends v40's REFERENCE rule, which changed",
  );
}

export const TURN_READER_V59: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV58Result
> = {
  ...TURN_READER_V58,
  version: 59,
  status: "DEPRECATED",
  changeDescription:
    "Coordinator live test 2026-10-23: v58 plus one REFERENCE rule -- asking Q to write, draft or send a note, message or email to a record's people (or to express interest, ask for a call, request a document) is a request to act, never to open the record: open is null; name/shown still identify it. Read by meaning in any language; schema unchanged.",
  effectiveFrom: "2026-10-23",
  template: TURN_READER_V58.template.replace(
    TURN_READER_V40_REFERENCES,
    `${TURN_READER_V40_REFERENCES}${V59_ACT_ON_IS_NOT_OPEN}`,
  ),
};
