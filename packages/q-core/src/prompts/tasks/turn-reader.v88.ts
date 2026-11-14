import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V88_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV88ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV88Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V87, V87_NAVIGATION_TAB } from "./turn-reader.v87.js";

/**
 * v88 (owner live 14 Nov 2026, run bba40261, audit D1). An investor asked
 * for the strongest fits while leaving out the companies they were already
 * in contact with; the reading had no way to say so, and Q listed three of
 * those companies, one it had just said they owe a reply. The one reading
 * now says it by meaning, in any language (`question.excludeRelationships`).
 * Which companies they are in contact with stays code's: their own
 * relationships, read as them, and a code check drops any that a list
 * would still show.
 *
 * One paragraph is added right after v87's NAVIGATION TAB; the output
 * schema adds `question.excludeRelationships`. Same single reading, no
 * extra call.
 */
export const V88_FIT_EXCLUDE_RELATIONSHIPS = `LEAVE OUT THEIR OWN: on a FIT or DISCOVER_COMPANIES question, write question.excludeRelationships true when they want companies other than the ones they are already in contact with -- in touch with, talking to, reached out to, connected with, already in their pipeline or their relationships -- by meaning, in any words and any language ("the strongest fits, leaving out companies I'm already in contact with", "which fit my mandate that I haven't reached out to yet?", "new names, not my pipeline", "skip the ones I'm talking to", "aparte de las que ya contacté", "hors celles avec qui je suis déjà en contact"). It is one of question's own fields, beside excludeShown. Write it false when they ask about those companies themselves ("rank my pipeline", "which of the companies I'm talking to fits best?"), when they only want past what Q showed (that is excludeShown), and for every other question kind.`;

if (TURN_READER_V87.template.split(V87_NAVIGATION_TAB).length !== 2) {
  throw new Error(
    "TURN_READER v88 follows v87's NAVIGATION TAB paragraph, which changed or repeats",
  );
}

export const TURN_READER_V88: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV88Result
> = {
  ...TURN_READER_V87,
  version: 88,
  status: "ACTIVE",
  changeDescription:
    "Owner live 14 Nov 2026 (run bba40261, D1: 'leaving out companies I'm already in contact with' listed three of them): v87 plus one LEAVE OUT THEIR OWN paragraph -- question.excludeRelationships on a FIT or DISCOVER_COMPANIES question when they want companies other than those they are already in contact with, by meaning in any language. Code excludes their own relationships, read as them, and drops any a list still shows. No extra model call.",
  effectiveFrom: "2026-11-14",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V88_SCHEMA_VERSION,
    schema: TurnReaderV88ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V87.template.replace(
    V87_NAVIGATION_TAB,
    `${V87_NAVIGATION_TAB}\n${V88_FIT_EXCLUDE_RELATIONSHIPS}`,
  ),
};
