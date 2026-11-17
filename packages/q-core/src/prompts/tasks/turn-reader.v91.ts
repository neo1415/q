import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V91_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV91ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV91Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V90, V90_FIT_REASONS } from "./turn-reader.v90.js";

/**
 * v91 (owner live 17 Nov 2026, conversation 9995dcca). The conditions of
 * the list Q just showed were carried into every following list ask: a
 * "pre-revenue" condition reached "any promising opportunities outside my
 * preferred sectors... keep them separate from my normal matches", a new
 * list. Whether a list ask refines the list just shown or asks for a new
 * one is meaning, so the one reading says it (`question.refinesShownList`);
 * code keeps the earlier conditions only on a refinement.
 *
 * One paragraph is added right after v90's WHY THEY FIT; the output schema
 * adds `question.refinesShownList`. Same single reading, no extra call.
 */
export const V91_REFINES_SHOWN_LIST = `REFINES THE LIST: on a FIT, DISCOVER_COMPANIES or INVESTOR_PROSPECTS question, write question.refinesShownList -- by meaning, in any words and any language -- true when they narrow, filter, re-order or trim the list Q just showed, so its earlier conditions still hold ("leave out the ones we're already in contact with" right after a list, "which of these are pre-revenue?", "only the ones with revenue", "and the weakest first?"); false when they ask for a new, different or separate list ("any promising opportunities outside my preferred sectors? keep them separate from my normal matches", "show me something else", "now find me fintech in Nigeria", "start over"); null when there was no list just before or you cannot tell. A refinement may add its own conditions; a new list has only the conditions it states.`;

if (TURN_READER_V90.template.split(V90_FIT_REASONS).length !== 2) {
  throw new Error(
    "TURN_READER v91 follows v90's WHY THEY FIT paragraph, which changed or repeats",
  );
}

export const TURN_READER_V91: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV91Result
> = {
  ...TURN_READER_V90,
  version: 91,
  status: "ACTIVE",
  changeDescription:
    "Owner live 17 Nov 2026 (conversation 9995dcca: a 'pre-revenue' condition was carried into a new 'outside my preferred sectors, keep them separate' list): v90 plus one REFINES THE LIST paragraph -- question.refinesShownList, true when the list ask narrows or trims the list just shown, false for a new or separate list, by meaning in any language. Code carries the earlier list's conditions only on a refinement. No extra model call.",
  effectiveFrom: "2026-11-17",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V91_SCHEMA_VERSION,
    schema: TurnReaderV91ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V90.template.replace(
    V90_FIT_REASONS,
    `${V90_FIT_REASONS}\n${V91_REFINES_SHOWN_LIST}`,
  ),
};
