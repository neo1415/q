import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V93_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV93ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV93Result,
} from "../schemas/turn-reader.js";
import { V91_REFINES_SHOWN_LIST } from "./turn-reader.v91.js";
import { TURN_READER_V92, V92_RULES_END_BEFORE } from "./turn-reader.v92.js";

/**
 * v93 (audit 2026-11-13 item 17, privacy). Whether the turn asks about
 * other parties' interest or activity on a company or relationship is read
 * by meaning (`othersActivity`), beside the word rule that alone decided it
 * before: a paraphrase, a spoken or non-English ask, or a follow-up ("and
 * how many of them?") now also brings the withholding note and the answer
 * check. The note only governs how Q says it; the data stays where only
 * the Network context's party checks can read it.
 *
 * One paragraph is added right after v91's REFINES THE LIST, inside the
 * fixed rules v92 sends as cacheable instructions; the boundary is v92's.
 * The output schema adds `othersActivity`. Same single reading.
 */
export const V93_OTHERS_ACTIVITY = `OTHERS' ACTIVITY: othersActivity is true when the turn asks -- by meaning, in any words and any language, spoken or typed, read with RECENT TURNS -- about the interest, activity or intentions on a company, a raise or a relationship of parties other than the person's own side: who else, which other or how many investors or funds are interested in, looking at, talking to, in diligence with, committing to, backing or passing on a company; other parties' cheques, commitments, terms or competing offers; or which companies another investor is looking at or has passed on ("is anybody else circling Kazikit?", "am I the only one looking at them?", "what's the competition like on this deal?", "has Kazikit got other suitors?", "anyone else kicking the tyres?", "how hot is this round, who's in?", "¿alguien más está mirando Kazikit?", "est-ce que d'autres fonds regardent Kazikit ?", "what else is Acme Ventures looking at?"), and for a follow-up that continues such an ask ("and how many of them?", "what are they putting in?"). It is false for their own interest, relationship or pipeline ("what's my interest in Kazikit?", "where do we stand with Kazikit?", "which investors fit us?"), for a founder asking about investors' interest in their own company ("which investors are interested in us?", "has Acme replied to us?"), and for every question that is not about other parties' activity.`;

if (TURN_READER_V92.template.split(V91_REFINES_SHOWN_LIST).length !== 2) {
  throw new Error(
    "TURN_READER v93 follows v91's REFINES THE LIST paragraph, which changed or repeats",
  );
}

export const TURN_READER_V93: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV93Result
> = {
  ...TURN_READER_V92,
  version: 93,
  status: "ACTIVE",
  changeDescription:
    "Audit 2026-11-13 item 17 (privacy): v92 plus one OTHERS' ACTIVITY paragraph -- othersActivity, true when the turn asks about other parties' interest, diligence, passes, cheques or commitments on a company or relationship, by meaning in any language and across follow-ups. Code withholds when either this or the existing word rule fires. Same rules boundary as v92; no extra model call.",
  effectiveFrom: "2026-11-18",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V93_SCHEMA_VERSION,
    schema: TurnReaderV93ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V92.template.replace(
    V91_REFINES_SHOWN_LIST,
    `${V91_REFINES_SHOWN_LIST}\n${V93_OTHERS_ACTIVITY}`,
  ),
  rulesEndBefore: V92_RULES_END_BEFORE,
};
