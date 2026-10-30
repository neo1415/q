import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V74_SCHEMA_VERSION,
  TurnReaderV74ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV74Result,
} from "../schemas/turn-reader.js";
import { V52_NEXT_STEPS } from "./turn-reader.v52.js";
import { TURN_READER_V73 } from "./turn-reader.v73.js";

/**
 * v74 (live 2026-10-30, founder.ledgerbridge, "What should I do today?" x3):
 *
 * - nextSteps is read beside question.kind, never from it. Two of three
 *   runs read the question as THEIR_OWN_RECORDS rather than ADVICE, and
 *   code's priorities and plan offer hung on ADVICE; code now keys them on
 *   nextSteps alone, and the reader is told plainly that either source
 *   class carries it.
 * - acceptsOffer: the turn takes Q up on what Q's own last turn offered.
 *   "yes" to "Want me to take you to the pending approvals?" was read as a
 *   screen move and re-guessed into account settings; code now binds the
 *   yes to the offer it recorded with Q's turn, and makes no move it did
 *   not record. Output schema v74 (v70 plus acceptsOffer).
 */
export const V74_NEXT_STEPS_ANY_KIND = `nextSteps is read beside question.kind and never depends on it: "what should I do today?" is nextSteps true whether you read the question as ADVICE or as THEIR_OWN_RECORDS.\n`;

export const V74_OFFER_TAKEN = `OFFER TAKEN: acceptsOffer is true when their turn takes you up on what your own last turn offered or invited them to have done -- "yes", "go ahead", "please do", "sure, take me there", "sí, hazlo", "نعم" -- read by meaning, in any words and any language. It is false when they decline, ask something about your answer instead, or ask for something new, and when your last turn offered nothing. It is read beside the other fields, never instead of them.\n`;

if (TURN_READER_V73.template.split(V52_NEXT_STEPS).length !== 2) {
  throw new Error(
    "TURN_READER v74 extends v52's NEXT STEPS rule, which changed",
  );
}

export const TURN_READER_V74: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV74Result
> = {
  ...TURN_READER_V73,
  version: 74,
  status: "ACTIVE",
  changeDescription:
    'Live 2026-10-30 ("What should I do today?"): v73 with NEXT STEPS read beside question.kind (ADVICE or THEIR_OWN_RECORDS both carry nextSteps) and OFFER TAKEN -- acceptsOffer when the turn takes Q up on what Q\'s own last turn offered, by meaning in any language, so code binds the yes to the offer it recorded. Output schema v74 (v70 plus acceptsOffer, lenient).',
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V74_SCHEMA_VERSION,
    schema: TurnReaderV74ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V73.template.replace(
    V52_NEXT_STEPS,
    `${V52_NEXT_STEPS}${V74_NEXT_STEPS_ANY_KIND}${V74_OFFER_TAKEN}`,
  ),
};
