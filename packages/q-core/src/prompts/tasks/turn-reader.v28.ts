import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V28_SCHEMA_VERSION,
  TurnReaderV28ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV28Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V26_HAND_OVER } from "./turn-reader.v26.js";
import {
  TURN_READER_V27,
  TURN_READER_V27_SAVE_TO_PROFILE,
} from "./turn-reader.v27.js";

/**
 * TURN_READER v28 -- v27, with the hand-over kept to what is handed over
 * (HARDEN P0, live 2026-10-02, Zino: "send a message to nixo telling them
 * I am looking forward to the next meeting" became an errand card, and
 * "book a meeting with Nixon the next five minutes" lost its time), plus
 * timeWindow. Read from meaning in any language.
 */
export const TURN_READER_V28_DIRECT = `NOT A HAND-OVER: one direct, specific request is a TOOL_REQUEST with handOver null, even when it names someone: send someone a message (with what to say), book, move or cancel a meeting at a time they give ("book a meeting with X in the next five minutes", "set up a call with X tomorrow at 3"), pass on someone, express interest, answer one request. handOver is only for handing Q the job itself: take over, look after or handle a relationship or a person, or get them a meeting without saying when, or several steps in one message (accept them and message them and book).
TIME WINDOW: timeWindow is set when they ask for something to happen within or after a time from now, in minutes from now: "in the next five minutes" is {fromMinutes: 0, toMinutes: 5}; "in an hour" is {fromMinutes: 60, toMinutes: null}; "tomorrow" is about {fromMinutes: minutes until tomorrow morning, toMinutes: minutes until tomorrow evening}. Null when they gave no time.
`;

if (!TURN_READER_V27.template.includes(TURN_READER_V27_SAVE_TO_PROFILE)) {
  throw new Error("TURN_READER v28 extends v27's save line, which changed");
}
if (!TURN_READER_V27.template.includes(TURN_READER_V26_HAND_OVER)) {
  throw new Error(
    "TURN_READER v28 extends v26's hand-over line, which changed",
  );
}

export const TURN_READER_V28: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV28Result
> = {
  ...TURN_READER_V27,
  version: 28,
  status: "DEPRECATED",
  changeDescription:
    "HARDEN P0 2026-10-02 (Zino): one direct request (a message, a meeting at a time, a pass) is a TOOL_REQUEST, never a hand-over; timeWindow carries a requested time relative to now.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V28_SCHEMA_VERSION,
    schema: TurnReaderV28ResultSchema,
  },
  template: TURN_READER_V27.template.replace(
    TURN_READER_V27_SAVE_TO_PROFILE,
    `${TURN_READER_V27_SAVE_TO_PROFILE}${TURN_READER_V28_DIRECT}`,
  ),
};
