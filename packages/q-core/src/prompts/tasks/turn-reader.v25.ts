import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V25_SCHEMA_VERSION,
  TurnReaderV25ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV25Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V24,
  TURN_READER_V24_ADDRESSED,
} from "./turn-reader.v24.js";

/**
 * TURN_READER v25 -- v24, plus endVoice (founder live 2026-10-02: "Go ahead
 * and save it. I approve it." ended a voice call). Read from meaning in
 * any language, as part of the turn's own reading.
 */
export const TURN_READER_V25_END_VOICE = `END VOICE: endVoice is true only when the whole message is about ending this spoken conversation or moving to typing ("bye Q", "let me type instead", "that's all, thanks", "on arrête là"). It is false whenever the message also approves or agrees to something ("go ahead", "save it", "I approve"), asks a question, requests anything or answers one: "go ahead and save it" never ends anything. Typed words are always false.
`;

export const TURN_READER_V25: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV25Result
> = {
  ...TURN_READER_V24,
  version: 25,
  status: "DEPRECATED",
  changeDescription:
    "Founder live 2026-10-02: endVoice, true only when the whole spoken message is about ending the voice conversation or switching to typing; never with an approval, request, question or answer.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V25_SCHEMA_VERSION,
    schema: TurnReaderV25ResultSchema,
  },
  template: TURN_READER_V24.template.replace(
    TURN_READER_V24_ADDRESSED,
    `${TURN_READER_V24_ADDRESSED}${TURN_READER_V25_END_VOICE}`,
  ),
};

if (TURN_READER_V25.template === TURN_READER_V24.template) {
  throw new Error(
    "TURN_READER v25 extends v24's addressed line, which changed",
  );
}
