import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V48_SCHEMA_VERSION,
  TurnReaderV48ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV48Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V47, V47_SUBJECT } from "./turn-reader.v47.js";

/**
 * TURN_READER v48 -- THEIR OWN COMPANY (founder brief K Part 4).
 *
 * A founder's "what does Capital Q have on my company" or "what stage is
 * my company at" is answered from their working snapshot (their own
 * company's record) without a tool round, like an investor's mandate.
 * The reader names it as a prepared subject, in any words.
 */
export const V48_SUBJECT = V47_SUBJECT.replace(
  "Q_WORK when it is about what Q or their agents are doing or have done for them.",
  "Q_WORK when it is about what Q or their agents are doing or have done for them; OWN_COMPANY when a founder asks about their own company as Capital Q holds it (its name, stage, country, how it is described).",
);

if (V48_SUBJECT === V47_SUBJECT) {
  throw new Error("TURN_READER v48 rewrites v47's SUBJECT rule, which changed");
}
if (TURN_READER_V47.template.split(V47_SUBJECT).length !== 2) {
  throw new Error("TURN_READER v48 rewrites v47, which changed: SUBJECT");
}

export const TURN_READER_V48: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV48Result
> = {
  ...TURN_READER_V47,
  version: 48,
  status: "ACTIVE",
  changeDescription:
    "Founder brief K Part 4: a founder's question about their own company is the OWN_COMPANY prepared subject, answered from their working snapshot without a tool round.",
  effectiveFrom: "2026-10-09",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V48_SCHEMA_VERSION,
    schema: TurnReaderV48ResultSchema,
  },
  template: TURN_READER_V47.template.replace(V47_SUBJECT, V48_SUBJECT),
};
