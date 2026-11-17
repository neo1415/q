import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V90_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV90ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV90Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V89, V89_LIST_CONDITIONS } from "./turn-reader.v89.js";

/**
 * v90 (owner live 17 Nov 2026, conversation 9995dcca, run 333d9645). After
 * a ranked list, "So, why are they the strongest fits? Don't just repeat
 * the descriptions" was read as FIT about the companies just shown and
 * nothing more, so code ranked the same companies again and said the same
 * tie line. The one reading now says, by meaning and in any language, that
 * they ask why those companies fit or rank as they do (`question.fitReasons`):
 * the reasons, not the list again. Which measures matched stays code's,
 * from the stored fit profiles.
 *
 * One paragraph is added right after v89's LIST CONDITIONS; the output
 * schema adds `question.fitReasons`. Same single reading, no extra call.
 */
export const V90_FIT_REASONS = `WHY THEY FIT: on a FIT question, write question.fitReasons true when they ask why companies fit or rank as they do -- the reasons behind a fit or a ranking, not the list again -- by meaning, in any words and any language ("why are they the strongest fits?", "what makes these the best matches?", "why is Nixo at the top?", "so why do they fit me? don't just repeat the descriptions", "¿por qué encajan?", "pourquoi sont-elles les meilleures ?"). Write it false when they ask for a list or a ranking ("rank them", "show me the strongest", "top three"), for a comparison of named companies, and for every other question kind.`;

if (TURN_READER_V89.template.split(V89_LIST_CONDITIONS).length !== 2) {
  throw new Error(
    "TURN_READER v90 follows v89's LIST CONDITIONS paragraph, which changed or repeats",
  );
}

export const TURN_READER_V90: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV90Result
> = {
  ...TURN_READER_V89,
  version: 90,
  status: "ACTIVE",
  changeDescription:
    "Owner live 17 Nov 2026 (run 333d9645: 'why are they the strongest fits?' re-ranked the same list and repeated the tie line): v89 plus one WHY THEY FIT paragraph -- question.fitReasons on a FIT question, by meaning in any language, when they ask why companies fit or rank as they do. Code answers from the stored fit profiles: which measures matched and which are unknown, no re-ranking. No extra model call.",
  effectiveFrom: "2026-11-17",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V90_SCHEMA_VERSION,
    schema: TurnReaderV90ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V89.template.replace(
    V89_LIST_CONDITIONS,
    `${V89_LIST_CONDITIONS}\n${V90_FIT_REASONS}`,
  ),
};
