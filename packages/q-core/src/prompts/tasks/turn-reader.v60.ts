import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V60_SCHEMA_VERSION,
  TurnReaderV60ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV60Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V59, V59_ACT_ON_IS_NOT_OPEN } from "./turn-reader.v59.js";

/**
 * v60 (QA 2026-10-23, F-36 / F-41 / F-33): three readings, by meaning in
 * any language, added after v59's REFERENCE rule. v59 is kept whole;
 * schema unchanged (v58).
 *
 * - F-36: "افتح صفحة الاكتشاف" ("open Discover") opened a company: a whole
 *   screen of Capital Q's, named in any language, is NAVIGATE to it.
 * - F-41: "Tell me more about the second one" opened its page: asking
 *   about a record Q showed is a question, answered here.
 * - F-33: "Reply to Rift Valley Seed Fund: accept their interest…" was
 *   read as a hand-over: answering an investor's interest in them is not
 *   handing work over.
 */
export const V60_SCREENS_ANY_LANGUAGE = `- A whole screen of Capital Q's own (Discover, Explore, Saved, their pipeline, settings, their documents...) named in any language is tool NAVIGATE to that destination, never a record to open and never a name to search ("افتح صفحة الاكتشاف" is NAVIGATE DISCOVER; "ouvre mes sauvegardes" is NAVIGATE SAVED).
`;
export const V60_ASKING_IS_NOT_OPEN = `- open is null when they ASK about a record rather than ask to see its page: "tell me more about the second one", "what does the first one do?", "and the third?" are questions (kind QUESTION_TO_Q), answered in the conversation; name and shown still say which record it is.
`;
export const V60_ANSWERING_INTEREST = `- Accepting or declining an interest an investor expressed in THEIR company, or replying to say yes to it ("reply to Rift Valley Seed Fund: accept their interest and suggest a call"), is answering that interest, by what it means, in any language: handOver is null and open is null; name is the investor.
`;

/**
 * Work-board lane S1 (2026-10-23): boardAsk, what they ask of their own
 * work board, by meaning in any language. Code composes SAVE and BREAKDOWN
 * from Q's last answer (never inventing tasks) and runs WORK through the
 * board tool; this reading decides nothing else.
 */
export const V60_BOARD_ASK = `BOARD ASK: boardAsk is what they ask of THEIR OWN work board, by what it means, in any words and any language. SAVE: keep something on their board -- Q's last answer, a document or a company the turn or the recent turns mean ("save that plan to my board", "put this on my board", "keep Kestrel on my board", "pin this to my to-dos", "mets ça sur mon tableau", "guarda esto en mi tablero"). BREAKDOWN: turn Q's last answer (a plan or recommendations) into separate tasks on their board ("break it into tasks", "split that plan into to-dos", "make each recommendation a task"); BREAKDOWN over SAVE when they ask for both ("save the plan and split it into to-dos"). WORK: Q starts working on items already on their board ("work on those items for me", "get going on my board", "start on the hiring task"). null otherwise: only asking what is on their board ("what's on my board?"), someone else's board, a GateQ inbox or board, or anything else.
`;

if (TURN_READER_V59.template.split(V59_ACT_ON_IS_NOT_OPEN).length !== 2) {
  throw new Error(
    "TURN_READER v60 extends v59's REFERENCE rule, which changed",
  );
}

export const TURN_READER_V60: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV60Result
> = {
  ...TURN_READER_V59,
  version: 60,
  status: "ACTIVE",
  changeDescription:
    "QA 2026-10-23: v59 plus four readings by meaning in any language -- work-board lane: boardAsk SAVE | BREAKDOWN | WORK | null for their own work board (BREAKDOWN over SAVE; only asking what is on it is null); F-36 a whole Capital Q screen named in any language is NAVIGATE to it, never a record; F-41 asking about a record Q showed ('tell me more about the second one') is a question, open null; F-33 accepting or declining an investor's interest in their company is answering it, never a hand-over. Schema unchanged.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V60_SCHEMA_VERSION,
    schema: TurnReaderV60ResultSchema,
  },
  template: TURN_READER_V59.template.replace(
    V59_ACT_ON_IS_NOT_OPEN,
    `${V59_ACT_ON_IS_NOT_OPEN}${V60_SCREENS_ANY_LANGUAGE}${V60_ASKING_IS_NOT_OPEN}${V60_ANSWERING_INTEREST}${V60_BOARD_ASK}`,
  ),
};
