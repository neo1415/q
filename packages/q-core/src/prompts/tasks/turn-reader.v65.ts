import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V64_SCHEMA_VERSION,
  TurnReaderV64ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV64Result,
} from "../schemas/turn-reader.js";
import { V62_COMPARE } from "./turn-reader.v62.js";
import { TURN_READER_V64 } from "./turn-reader.v64.js";

/**
 * v65 (coordinator 2026-10-24, run beb74547): "Which is better, Anchor or
 * Afyascan?" came back with no compare, so the side-by-side was never
 * drawn (lane 8's #460 holds a phrase fallback until this ships). A choice
 * between named companies, in any words and any language, is compare with
 * their names, read by meaning -- also when it asks which fits them. The
 * live v64 is kept whole; same output schema.
 */
export const V65_CHOICE_IS_COMPARE = `A CHOICE BETWEEN NAMED COMPANIES is compare with their names, in the order said, whatever else the turn is: "which is better, A or B?", "which fits me more, A or B?", "would you pick A or B?", "A or B -- which one?", "should I back A or B?", "¿cuál es mejor, A o B?", "lequel est le meilleur, A ou B ?", "أيهما أفضل، A أم B؟". A question of fit or of which to choose sets compare as well, never instead of it.`;

if (TURN_READER_V64.template.split(V62_COMPARE).length !== 2) {
  throw new Error("TURN_READER v65 extends v62's COMPARE rule, which changed");
}

export const TURN_READER_V65: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV64Result
> = {
  ...TURN_READER_V64,
  version: 65,
  status: "ACTIVE",
  changeDescription:
    "Coordinator 2026-10-24 (run beb74547): v64 plus A CHOICE BETWEEN NAMED COMPANIES -- 'which is better / fits me more / would you pick, A or B', in any words and any language -- is compare {names} in the order said, also when it asks which fits; a fit question sets compare as well, never instead of it.",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V64_SCHEMA_VERSION,
    schema: TurnReaderV64ResultSchema,
  },
  template: TURN_READER_V64.template.replace(
    V62_COMPARE,
    `${V62_COMPARE.trimEnd()}\n${V65_CHOICE_IS_COMPARE}\n`,
  ),
};
