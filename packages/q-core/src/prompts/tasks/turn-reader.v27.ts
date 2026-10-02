import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V27_SCHEMA_VERSION,
  TurnReaderV27ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV27Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V26,
  TURN_READER_V26_HAND_OVER,
} from "./turn-reader.v26.js";

/**
 * TURN_READER v27 -- v26, plus saveToOwnProfile (HARDEN P0, live
 * 2026-10-02, Nixo: permission to fill the profile from what is online was
 * answered with a lecture). Read from meaning in any language.
 */
export const TURN_READER_V27_SAVE_TO_PROFILE = `SAVE TO OWN PROFILE: saveToOwnProfile is true when the person authorises Q to put what research finds, or what Q already found, into their OWN profile ("search online and update my profile", "fill the gaps in my profile from what you find", "save what you found to my profile", "you have my permission to update my profile with what's online"), in any words and any language. It is false for a question about their profile, for research without saving, for a change they dictate themselves, and for anyone else's profile.
`;

if (!TURN_READER_V26.template.includes(TURN_READER_V26_HAND_OVER)) {
  throw new Error(
    "TURN_READER v27 extends v26's hand-over line, which changed",
  );
}

export const TURN_READER_V27: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV27Result
> = {
  ...TURN_READER_V26,
  version: 27,
  status: "DEPRECATED",
  changeDescription:
    "HARDEN P0 2026-10-02: saveToOwnProfile, true when the person authorises saving research or findings into their own profile; code fills the open fields itself.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V27_SCHEMA_VERSION,
    schema: TurnReaderV27ResultSchema,
  },
  template: TURN_READER_V26.template.replace(
    TURN_READER_V26_HAND_OVER,
    `${TURN_READER_V26_HAND_OVER}${TURN_READER_V27_SAVE_TO_PROFILE}`,
  ),
};
