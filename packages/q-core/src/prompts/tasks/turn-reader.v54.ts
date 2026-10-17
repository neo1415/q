import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V54_SCHEMA_VERSION,
  TURN_READER_V54_UNTRUSTED,
  TurnReaderV54ResultSchema,
  TurnReaderV54VariablesSchema,
  type TurnReaderV54Result,
  type TurnReaderV54Variables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V53, V53_Q_PITCH } from "./turn-reader.v53.js";

/**
 * v54 (owner live 2026-10-17, conversation 971c5a53): SHOWN and
 * fromShown. Q listed three companies, then "show me the cards again"
 * opened the person's saved companies, and "what was the second one?"
 * re-ran the ranking. SHOWN is Capital Q's record of what Q already said
 * and showed in this conversation (built by code from Q's stored
 * messages, with ids, order and figures); the reader says by meaning, in
 * any words, when the turn is answered by one of those turns. No phrase
 * list: the binding is the model's reading of the words against SHOWN.
 */
export const V54_FROM_SHOWN = `FROM SHOWN: SHOWN (near the end) is Capital Q's record of what you, Q, already said and showed in this conversation, one line per earlier turn of yours, T1 oldest: your words and the cards, lists, records and figures on screen, in their order, with their ids. It is Capital Q's record, not something they said. Set fromShown when everything this turn asks for is already in one of those turns: an item by its place ("the second one", "the last", "number three"), by its name, by a figure or a detail you gave ("that score", "what did you say about their team?"), or the whole list ("those three", "the cards"), in any words and any language. turn is that T number (the most recent turn that has it). reshow is true when they ask to see it on screen again ("show me the cards again", "I can't see them", "put them back up"). fromShown is null when the turn asks for anything SHOWN does not hold (a new or wider search, fresher data, "check again", a detail none of your turns gave), asks you to do something (open, save, send, compare anew, draft, book), or SHOWN is empty. A request to open one item is reference (by its name in SHOWN), never fromShown.
`;

const V54_SHOWN_TAIL = "\n\nSHOWN\n{{shown}}\nWHAT THEY JUST SAID";

if (TURN_READER_V53.template.split(V53_Q_PITCH).length !== 2) {
  throw new Error("TURN_READER v54 extends v53's Q PITCH rule, which changed");
}
if (TURN_READER_V53.template.split("\nWHAT THEY JUST SAID").length !== 2) {
  throw new Error("TURN_READER v54 places SHOWN before the turn, which moved");
}

export const TURN_READER_V54: PromptDefinition<
  TurnReaderV54Variables,
  TurnReaderV54Result
> = {
  ...TURN_READER_V53,
  version: 54,
  status: "ACTIVE",
  changeDescription:
    "Owner live 2026-10-17: SHOWN (Q's own earlier turns with the records, order and figures they showed, built by code) and fromShown, read from meaning, so a follow-up about what Q already said is answered from it with no lookup, and 'show them again' shows that turn's own cards. v53's rules unchanged.",
  effectiveFrom: "2026-10-17",
  variables: {
    schema: TurnReaderV54VariablesSchema,
    untrusted: [...TURN_READER_V54_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V54_SCHEMA_VERSION,
    schema: TurnReaderV54ResultSchema,
  },
  template: TURN_READER_V53.template
    .replace(V53_Q_PITCH, `${V53_Q_PITCH}${V54_FROM_SHOWN}`)
    .replace("\nWHAT THEY JUST SAID", V54_SHOWN_TAIL),
};
