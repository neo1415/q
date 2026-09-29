import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V15_SCHEMA_VERSION,
  TurnReaderV15ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V14 } from "./turn-reader.v14.js";

/**
 * TURN_READER v15 — v14, plus who the words were for (founder live
 * 2026-09-29). With voice on, Q heard a phone call and a colleague in the
 * room and answered them: "Sorry, say that again?", a stranger's sentence
 * recorded as the founder's statement, a misheard name repeated back. The
 * reader now says when spoken words were plainly meant for someone else,
 * and Capital Q stays quiet for them.
 */
export const TURN_READER_V15_ADDRESSED = `ADDRESSED: addressedToQ is false only for spoken words plainly meant for someone else or not meant for anyone: talk to another person (a name that is not Q, "not you", "sorry, continue"), one side of a call, a TV or lecture, reading aloud, muttering. If the words could reasonably be for Q, including a request, a question or a remark to Q, it is true. Typed words are always true.
`;

const V14_TRANSCRIPT_ANCHOR = "TRANSCRIPT (modality {{modality}}):";

if (!TURN_READER_V14.template.includes(V14_TRANSCRIPT_ANCHOR)) {
  throw new Error(
    "TURN_READER v15 adds its line before v14's transcript line, which v14 lost",
  );
}

export const TURN_READER_V15: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V14,
  version: 15,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-29: addressedToQ says when spoken words were plainly for someone else (a call, a colleague, background), so Q stays silent instead of answering the room.",
  effectiveFrom: "2026-09-29",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V15_SCHEMA_VERSION,
    schema: TurnReaderV15ResultSchema,
  },
  template: TURN_READER_V14.template.replace(
    V14_TRANSCRIPT_ANCHOR,
    `${TURN_READER_V15_ADDRESSED}${V14_TRANSCRIPT_ANCHOR}`,
  ),
};
