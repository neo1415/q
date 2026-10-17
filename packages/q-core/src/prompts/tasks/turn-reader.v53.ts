import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V52_SCHEMA_VERSION,
  TurnReaderV52ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV52Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V52, V52_NEXT_STEPS } from "./turn-reader.v52.js";

/**
 * v53 (Q Pitch v6, owner 2026-10-16): Q_PITCH, read from meaning. When
 * they ask Q to present, pitch, explain or demo Capital Q itself (or what
 * Q can do), the turn is NAVIGATE to Q_PITCH, and code starts the guided
 * tour for their side. Asking about a pitch, a pitch deck or their own
 * pitch is not it. v52's rules (lane ml's nextSteps, U's routing) are
 * unchanged; the schema is v52's (the destination enum is the contract's).
 */
export const V53_Q_PITCH = `Q PITCH: when they ask you to present, pitch, introduce, explain, walk them through or demo Capital Q itself, or ask what you or this platform can do, in any words and any language ("pitch Capital Q", "explain Capital Q to us", "what can you do?", "show me what this is", "présente-nous Capital Q", "¿qué puedes hacer?"), the turn is tool NAVIGATE with destination Q_PITCH. It is not Q_PITCH when they ask about a pitch, a pitch deck or video, their own or a company's pitch, how to pitch, or one feature ("what is a pitch deck?", "open my pitch", "how do I improve my pitch?", "what can you do with my deck?"): read those as before.\n`;

if (TURN_READER_V52.template.split(V52_NEXT_STEPS).length !== 2) {
  throw new Error(
    "TURN_READER v53 extends v52's NEXT STEPS rule, which changed",
  );
}

export const TURN_READER_V53: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV52Result
> = {
  ...TURN_READER_V52,
  version: 53,
  status: "ACTIVE",
  changeDescription:
    "Q Pitch v6 (owner 2026-10-16): Q_PITCH, read from meaning in any language, so 'pitch / explain / show Capital Q' or 'what can you do?' starts the guided tour; questions about pitches or pitch decks are not it. v52's rules and schema unchanged.",
  effectiveFrom: "2026-10-16",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V52_SCHEMA_VERSION,
    schema: TurnReaderV52ResultSchema,
  },
  template: TURN_READER_V52.template.replace(
    V52_NEXT_STEPS,
    `${V52_NEXT_STEPS}${V53_Q_PITCH}`,
  ),
};
