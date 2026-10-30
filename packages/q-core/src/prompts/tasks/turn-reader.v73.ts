import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V70_SCHEMA_VERSION,
  TurnReaderV70ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV70Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V72, V72_PLAN_ASK } from "./turn-reader.v72.js";

/**
 * v73 (owner 2026-10-30, "What should I do today?"): the conversational
 * answer to what to do now closes with Q's offer to build a full plan
 * (readiness-lead.ts). Taking Q up on that offer -- in any words, any
 * language -- is asking for the plan, so it is read as the plan ask it is;
 * a question that only follows up on the answer is not. Only the PLAN ASK
 * rule gains this; output schema v70, unchanged.
 */
export const V73_PLAN_OFFER_TAKEN = `When your own last turn offered to build them a full plan and they take you up on it ("yes", "go ahead", "please do", "sí, hazlo", "نعم"), that is a plan ask: planAsk {kind GOAL, subject OWN, deliverable PLAN}, with side as in your offer. When they only ask about something in your answer, or decline, planAsk stays null.`;

export const V73_PLAN_ASK = `${V72_PLAN_ASK.trimEnd()} ${V73_PLAN_OFFER_TAKEN}
`;

if (TURN_READER_V72.template.split(V72_PLAN_ASK).length !== 2) {
  throw new Error("TURN_READER v73 extends v72's PLAN ASK rule, which changed");
}

export const TURN_READER_V73: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV70Result
> = {
  ...TURN_READER_V72,
  version: 73,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-30: v72 with PLAN ASK reading a yes to Q's own offer to build a full plan (made at the end of an answer to what to do now) as the plan ask {kind GOAL, subject OWN, deliverable PLAN}; a follow-up question or a no leaves planAsk null. Output schema v70, unchanged.",
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V70_SCHEMA_VERSION,
    schema: TurnReaderV70ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V72.template.replace(V72_PLAN_ASK, V73_PLAN_ASK),
};
