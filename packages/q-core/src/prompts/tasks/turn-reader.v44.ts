import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V44_SCHEMA_VERSION,
  TurnReaderV44ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV44Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V43 } from "./turn-reader.v43.js";

/**
 * TURN_READER v44 -- READ GARBLED SPEECH BY SOUND (Zino, live 2026-10-08
 * 11:13 UTC).
 *
 * On a voice call "find anything that needs my attention" reached Q as
 * "Fidiani inanituma attention". It was read UNCLEAR_TRANSCRIPT, Q said
 * nothing, and the voice filled the gap by asking for more detail. The
 * recogniser often turns accented English into foreign-looking words;
 * read by sound, with the conversation and the screen, the request is
 * usually plain. heardAs carries the likely words, so Q answers them.
 */
export const V43_UNCLEAR =
  "- UNCLEAR_TRANSCRIPT: the words are noise, a fragment, or cut off so badly that no meaning can be read. Only for words you genuinely cannot read.";
export const V44_UNCLEAR = `${V43_UNCLEAR} On VOICE, first read the words by sound: the recogniser often turns accented English into words that look foreign or meaningless ("Fidiani inanituma attention" is "find anything that needs my attention"; "sho mi di dek" is "show me the deck"). When they sound like a plausible request to Q that fits RECENT TURNS, their screen or the ACTIONS, read the turn as that request (CONFIDENCE MEDIUM, TRANSCRIPT NOISY) and set heardAs. UNCLEAR_TRANSCRIPT only when nothing plausible sounds like them.`;
export const V43_TRANSCRIPT_HEAD =
  "TRANSCRIPT (modality: see MODALITY near the end):";
export const V44_HEARD_AS = `HEARD AS: heardAs is the English words they most likely said, when you read garbled VOICE words by sound; null when the words read as written, and always null for typed words.
`;

for (const anchor of [V43_UNCLEAR, V43_TRANSCRIPT_HEAD]) {
  if (TURN_READER_V43.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v44 rewrites v43, which changed: ${anchor}`);
  }
}

export const TURN_READER_V44: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV44Result
> = {
  ...TURN_READER_V43,
  version: 44,
  status: "ACTIVE",
  changeDescription:
    "Zino live 2026-10-08: garbled voice words are read by sound before UNCLEAR_TRANSCRIPT; heardAs carries the likely words so Q answers them instead of going silent.",
  effectiveFrom: "2026-10-08",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V44_SCHEMA_VERSION,
    schema: TurnReaderV44ResultSchema,
  },
  template: TURN_READER_V43.template
    .replace(V43_UNCLEAR, V44_UNCLEAR)
    .replace(V43_TRANSCRIPT_HEAD, `${V44_HEARD_AS}${V43_TRANSCRIPT_HEAD}`),
};
