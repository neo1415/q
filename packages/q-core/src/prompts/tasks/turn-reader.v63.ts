import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V63_SCHEMA_VERSION,
  TurnReaderV63ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV63Result,
} from "../schemas/turn-reader.js";
import { V61_BOARD_ASK } from "./turn-reader.v61.js";
import { TURN_READER_V62 } from "./turn-reader.v62.js";

/**
 * v63 (coordinator and work-board lane, QA live 2026-10-24): "What is on
 * my board?" was answered from the readiness store and "Add 'Prep data
 * room for seed round' to my board" filed Q's previous answer instead: no
 * reading named either. boardAsk gains LIST and ADD, by meaning in any
 * language. The live v62 is kept whole.
 */
export const V63_BOARD_LIST_ADD = `BOARD ASK, two more: LIST when they only ask what is on their own work board, in any words and any language ("what's on my board?", "show my work board", "what's in my to-dos", "qu'y a-t-il sur mon tableau ?"); ADD when they give a new item to put on it in their own words ("add 'Prep IC memo for Mizan' to my board", "put 'call Kestrel on Friday' on my to-dos", "ajoute « relancer Savanna » à mon tableau"). SAVE, BREAKDOWN and WORK win over LIST; keeping something you said or showed (your last answer, a document, a company) stays SAVE, not ADD. Opening the board page stays NAVIGATE BOARD.
`;

if (TURN_READER_V62.template.split(V61_BOARD_ASK).length !== 2) {
  throw new Error(
    "TURN_READER v63 extends v61's BOARD ASK rule, which changed",
  );
}

export const TURN_READER_V63: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV63Result
> = {
  ...TURN_READER_V62,
  version: 63,
  status: "DEPRECATED",
  changeDescription:
    "Coordinator and work-board lane (QA live 2026-10-24): v62 plus boardAsk LIST (only asking what is on their own work board) and ADD (a new item in their own words), by meaning in any language; SAVE, BREAKDOWN and WORK win over LIST; keeping something Q said stays SAVE; opening the page stays NAVIGATE BOARD.",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V63_SCHEMA_VERSION,
    schema: TurnReaderV63ResultSchema,
  },
  template: TURN_READER_V62.template.replace(
    V61_BOARD_ASK,
    `${V61_BOARD_ASK}${V63_BOARD_LIST_ADD}`,
  ),
};
