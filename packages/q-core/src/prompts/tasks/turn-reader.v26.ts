import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV25Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V23_HAND_OVER } from "./turn-reader.v23.js";
import { TURN_READER_V25 } from "./turn-reader.v25.js";

/**
 * TURN_READER v26 -- v25 with a sharper hand-over (live 2026-10-02, Zino:
 * "Accept TALUM and send them a message. You can book a meeting with them
 * too." was read as a TOOL_REQUEST with no hand-over, so the code that
 * knows his own interest waits for Tallyloom never ran). Accepting
 * someone and then messaging them, booking a meeting with them or
 * "chatting them up" is Q taking the relationship over, by meaning. Same
 * output schema.
 */
export const TURN_READER_V26_HAND_OVER = `${TURN_READER_V23_HAND_OVER.trimEnd()} Asking you to accept or answer someone and then message them, book a meeting or call with them, or chat them up for them, in one message, is a hand-over: HAND_OVER, or MEETING when it is only about a meeting, with counterpartName as they said it, even when the name is misheard and even when the acceptance is not theirs to give.
`;

if (!TURN_READER_V25.template.includes(TURN_READER_V23_HAND_OVER)) {
  throw new Error(
    "TURN_READER v26 extends v23's hand-over line, which changed",
  );
}

export const TURN_READER_V26: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV25Result
> = {
  ...TURN_READER_V25,
  version: 26,
  status: "DEPRECATED",
  changeDescription:
    "Live 2026-10-02: accept someone and then message them, book a meeting with them or chat them up is a hand-over (HAND_OVER or MEETING) with counterpartName as said, by meaning.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V25.template.replace(
    TURN_READER_V23_HAND_OVER,
    TURN_READER_V26_HAND_OVER,
  ),
};
