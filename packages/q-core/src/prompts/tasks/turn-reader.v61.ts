import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V61_SCHEMA_VERSION,
  TurnReaderV61ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV61Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V60, V60_ANSWERING_INTEREST } from "./turn-reader.v60.js";

/**
 * v61 (2026-10-23): the live v60 kept whole, plus two readings.
 *
 * - Work-board lane S1: boardAsk, what they ask of their own work board,
 *   by meaning in any language. Code composes SAVE and BREAKDOWN from Q's
 *   last answer (never inventing tasks) and runs WORK through the board
 *   tool; this reading decides nothing else.
 * - QO-08: "Draft a note to the Duplo founders expressing interest, don't
 *   send" was answered "this message tool only drafts notes to connected
 *   companies... want me to?". A note expressing interest to founders they
 *   are not connected with IS Express Interest with that note: askedAction
 *   is the interest, prepared for approval ("don't send" is what approval
 *   already means), never a question back.
 */
export const V61_BOARD_ASK = `BOARD ASK: boardAsk is what they ask of THEIR OWN work board, by what it means, in any words and any language. SAVE: keep something on their board -- Q's last answer, a document or a company the turn or the recent turns mean ("save that plan to my board", "put this on my board", "keep Kestrel on my board", "pin this to my to-dos", "mets ça sur mon tableau", "guarda esto en mi tablero"). BREAKDOWN: turn Q's last answer (a plan or recommendations) into separate tasks on their board ("break it into tasks", "split that plan into to-dos", "make each recommendation a task"); BREAKDOWN over SAVE when they ask for both ("save the plan and split it into to-dos"). WORK: Q starts working on items already on their board ("work on those items for me", "get going on my board", "start on the hiring task"). null otherwise: only asking what is on their board ("what's on my board?"), someone else's board, a GateQ inbox or board, or anything else.
`;

export const V61_INTEREST_WITH_NOTE = `- A note or message to founders they are not connected with that expresses interest, or asks to talk ("draft a note to the Duplo founders expressing interest, don't send", "tell Silo Credit's founders I'd like a call"), is Express Interest with that note, by what it means, in any language: askedAction is the action that expresses interest, prepared for their approval; "don't send" or "just draft it" means exactly that approval, never a reason to ask first.
`;

if (TURN_READER_V60.template.split(V60_ANSWERING_INTEREST).length !== 2) {
  throw new Error("TURN_READER v61 extends v60's interest rule, which changed");
}

export const TURN_READER_V61: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV61Result
> = {
  ...TURN_READER_V60,
  version: 61,
  status: "DEPRECATED",
  changeDescription:
    "2026-10-23: v60 plus two readings by meaning in any language -- work-board lane: boardAsk SAVE | BREAKDOWN | WORK | null for their own work board (BREAKDOWN over SAVE; only asking what is on it is null); QO-08: a note expressing interest to founders they are not connected with is Express Interest with that note, prepared for approval, never a question back.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V61_SCHEMA_VERSION,
    schema: TurnReaderV61ResultSchema,
  },
  template: TURN_READER_V60.template.replace(
    V60_ANSWERING_INTEREST,
    `${V60_ANSWERING_INTEREST}${V61_INTEREST_WITH_NOTE}${V61_BOARD_ASK}`,
  ),
};
