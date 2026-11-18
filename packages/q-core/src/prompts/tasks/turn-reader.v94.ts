import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V94_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV94ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV94Result,
} from "../schemas/turn-reader.js";
import { V92_RULES_END_BEFORE } from "./turn-reader.v92.js";
import { TURN_READER_V93, V93_OTHERS_ACTIVITY } from "./turn-reader.v93.js";

/**
 * v94 (live 18 Nov 2026, fictional Savanna, run cce59657): "Am I in
 * contact with any of those?", right after a list of three, was answered
 * with a side-by-side comparison of them. Whether the turn asks about the
 * person's own contact or relationship with particular companies is now
 * read by meaning (`contactStatus`); code answers it from the one
 * in-contact rule over their own relationships, naming each company and
 * its stage.
 *
 * One paragraph is added right after v93's OTHERS' ACTIVITY, inside the
 * fixed rules v92 sends as cacheable instructions; the boundary is v92's.
 * The output schema adds `contactStatus`. Same single reading.
 */
export const V94_CONTACT_STATUS = `CONTACT STATUS: contactStatus is true when the turn asks -- by meaning, in any words and any language, spoken or typed, read with RECENT TURNS -- whether the person is already in contact, in touch, talking or connected with, or has a relationship with, particular companies or investors: ones it names, ones Q just showed or referred to, or which of those they are ("am I in contact with any of those?", "have I spoken to any of them?", "are any of these already in my pipeline?", "which of these am I already talking to?", "do I already know Ledgerline?", "where do I stand with those three?", "¿ya estoy en contacto con alguna de ellas?", "est-ce que je suis déjà en contact avec l'une d'elles ?"). Write the companies it means in references, as for any turn. It is false for a list that leaves out or keeps only their contacts (that is excludeRelationships and listConditions), for a comparison of those companies ("how do those compare?"), for other parties' activity (that is othersActivity), and for every other turn.`;

if (TURN_READER_V93.template.split(V93_OTHERS_ACTIVITY).length !== 2) {
  throw new Error(
    "TURN_READER v94 follows v93's OTHERS' ACTIVITY paragraph, which changed or repeats",
  );
}

export const TURN_READER_V94: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV94Result
> = {
  ...TURN_READER_V93,
  version: 94,
  status: "ACTIVE",
  changeDescription:
    "Live 18 Nov 2026 (fictional Savanna, run cce59657): v93 plus one CONTACT STATUS paragraph -- contactStatus, true when the turn asks whether the person is in contact or has a relationship with particular companies (named, shown or referred to), by meaning in any language. Code answers it from the shared in-contact rule. Same rules boundary as v92; no extra model call.",
  effectiveFrom: "2026-11-18",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V94_SCHEMA_VERSION,
    schema: TurnReaderV94ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V93.template.replace(
    V93_OTHERS_ACTIVITY,
    `${V93_OTHERS_ACTIVITY}\n${V94_CONTACT_STATUS}`,
  ),
  rulesEndBefore: V92_RULES_END_BEFORE,
};
