import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV22Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V22,
  TURN_READER_V22_HAND_OVER,
} from "./turn-reader.v22.js";

/**
 * TURN_READER v23 -- v22 with examples in the hand-over line (live
 * 2026-10-01: "handle this for me" on a company's page was not read as a
 * hand-over, while "get me a meeting with this person" was). A few varied
 * examples guide the reading of meaning -- a short form, another language
 * or register, an implicit one -- and are not a list to match. Same
 * output schema.
 */
export const TURN_READER_V23_HAND_OVER = TURN_READER_V22_HAND_OVER.replace(
  "in any words and any language.",
  'in any words and any language: short ("handle this for me"), in another language or register ("occupe-toi de ça", "abeg help me sort this one out"), or implied ("can you take it from here?") all count.',
);

if (TURN_READER_V23_HAND_OVER === TURN_READER_V22_HAND_OVER) {
  throw new Error(
    "TURN_READER v23 extends v22's hand-over line, which changed",
  );
}

export const TURN_READER_V23: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV22Result
> = {
  ...TURN_READER_V22,
  version: 23,
  status: "DEPRECATED",
  changeDescription:
    'QA live 2026-10-01: varied examples in the hand-over line (short, another language or register, implied), so "handle this for me" is read as a hand-over; questions about meetings still are not.',
  effectiveFrom: "2026-10-01",
  template: TURN_READER_V22.template.replace(
    TURN_READER_V22_HAND_OVER,
    TURN_READER_V23_HAND_OVER,
  ),
};
