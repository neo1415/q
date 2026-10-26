import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V67_SCHEMA_VERSION,
  TurnReaderV65ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV65Result,
} from "../schemas/turn-reader.js";
import { V65_CHOICE_IS_COMPARE } from "./turn-reader.v65.js";
import { TURN_READER_V66 } from "./turn-reader.v66.js";

/**
 * v67 (guard I-top-five, coordinator 2026-10-26, run 97d4c273): after five
 * ranked cards, "How do the top two stack up?" was read as a question to Q
 * with no compare, so the side-by-side never ran. v62's COMPARE has "how do
 * they stack up?" after two cards; the top N of a longer list Q showed is
 * the same comparison, by meaning in any language. The live v66 is kept
 * whole; same output schema; research is read as before.
 */
export const V67_TOP_N_COMPARE = `THE TOP N OF A LIST YOU SHOWED: "how do the top two stack up?", "how do the first three compare?", "the top two -- how do they measure up?", "and the top three against each other?", "¿cómo se comparan los dos primeros?", in any words and any language, after you showed a list of more companies than that, is compare with count N, taken from the top of that list as you showed it. It is compare whatever else the turn is (a question to you, a request for advice), never a question about one of them.`;

if (TURN_READER_V66.template.split(V65_CHOICE_IS_COMPARE).length !== 2) {
  throw new Error(
    "TURN_READER v67 extends v65's CHOICE IS COMPARE rule, which changed",
  );
}

export const TURN_READER_V67: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV65Result
> = {
  ...TURN_READER_V66,
  version: 67,
  status: "DEPRECATED",
  changeDescription:
    "Guard I-top-five (coordinator 2026-10-26, run 97d4c273): v66 plus THE TOP N OF A LIST YOU SHOWED -- 'how do the top two stack up / the first three compare', in any words and any language, after a longer list Q showed -- is compare {count: N} from the top of that list, whatever else the turn is. Same output schema; research is read as before.",
  effectiveFrom: "2026-10-26",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V67_SCHEMA_VERSION,
    schema: TurnReaderV65ResultSchema,
  },
  template: TURN_READER_V66.template.replace(
    V65_CHOICE_IS_COMPARE,
    `${V65_CHOICE_IS_COMPARE}\n${V67_TOP_N_COMPARE}`,
  ),
};
