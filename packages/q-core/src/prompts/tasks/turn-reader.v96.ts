import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V96_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV96ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV96Result,
} from "../schemas/turn-reader.js";
import { V92_RULES_END_BEFORE } from "./turn-reader.v92.js";
import { TURN_READER_V95, V95_ANSWER_PLAN } from "./turn-reader.v95.js";

/**
 * v96 (HQ-5 follow-up, 20 Nov 2026): live, fictional Savanna's "I'm not
 * really sure what I'm looking for right now" did not open discovery.
 * `seeksGuidance` is read by meaning: they state they do not yet know what
 * they want and want help working it out. Code opens discovery on that
 * first turn (answer-plan.ts). One sentence after v95's ANSWER PLAN,
 * inside the rules v92 sends as cacheable instructions; same boundary.
 */
export const V96_SEEKS_GUIDANCE = `seeksGuidance is true when they say they do not yet know what they want or where to start and want help working it out -- by meaning, in any language ("not sure what I'm looking for", "I don't know what I want", "where do I start?", "help me figure out what to do") -- and false when they ask for something, even vaguely, or ask for advice on a plain question. It is about form only. excludes lists, by name as they said it (resolve "them" or "that one" from RECENT TURNS), each company, person or topic they ask you to leave out from now on ("not Tensorgate", "I don't want anything about them"); empty when they exclude nothing, and never a name they merely mention. choiceUnclear is true when their turn is only a yes (or go ahead) to your last question that offered more than one option, and they did not say which; false when that question offered one thing, or they named or pointed at an option.`;

if (TURN_READER_V95.template.split(V95_ANSWER_PLAN).length !== 2) {
  throw new Error(
    "TURN_READER v96 follows v95's ANSWER PLAN paragraph, which changed or repeats",
  );
}

export const TURN_READER_V96: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV96Result
> = {
  ...TURN_READER_V95,
  version: 96,
  status: "ACTIVE",
  changeDescription:
    "HQ-5 follow-up and VOICE-FIX (20 Nov 2026): v95 plus seeksGuidance (they do not yet know what they want: code opens discovery on that first turn), excludes (what they asked Q to leave out from now on, held by code) and choiceUnclear (a bare yes to a question of several options: code asks which). Read by meaning in any language. Same rules boundary as v92; no extra model call.",
  effectiveFrom: "2026-11-20",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V96_SCHEMA_VERSION,
    schema: TurnReaderV96ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V95.template.replace(
    V95_ANSWER_PLAN,
    `${V95_ANSWER_PLAN} ${V96_SEEKS_GUIDANCE}`,
  ),
  rulesEndBefore: V92_RULES_END_BEFORE,
};
