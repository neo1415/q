import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV55Variables,
  TurnReaderV56Result,
} from "../schemas/turn-reader.js";
import { V53_Q_PITCH } from "./turn-reader.v53.js";
import { TURN_READER_V56 } from "./turn-reader.v56.js";

/**
 * v57 (Q Story, owner 2026-10-21): "present / pitch Capital Q" still opens
 * the guided story (Q_PITCH), but a bare "What is Capital Q?" is a
 * question, not a request for a seven-minute film: it is answered in a
 * couple of plain sentences, and Q may offer to show the story. v56 is kept
 * whole; the Q PITCH rule gains this one exception, read by meaning in any
 * language. Output schema unchanged (v56).
 */
export const V57_WHAT_IS_CAPITAL_Q = `Q PITCH, ONLY WHAT IT IS: when they only ask what Capital Q (or this platform, or you) is, in a few words and nothing more, by what it means, in any language ("what is Capital Q?", "what's this?", "c'est quoi Capital Q ?", "¿qué es Capital Q?"), it is NOT Q_PITCH and has no tool: it is an ordinary question, answered briefly. It is Q_PITCH only when they ask to be shown, presented, pitched, walked through or told the story ("present Capital Q", "pitch Capital Q", "tell me your story", "show me what this is", "yes, show me" after Q offered to show it).
`;

if (TURN_READER_V56.template.split(V53_Q_PITCH).length !== 2) {
  throw new Error("TURN_READER v57 extends v53's Q PITCH rule, which changed");
}

export const TURN_READER_V57: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV56Result
> = {
  ...TURN_READER_V56,
  version: 57,
  status: "DEPRECATED",
  changeDescription:
    "Q Story (owner 2026-10-21): v56 plus one Q PITCH exception -- a bare 'what is Capital Q?' (asking only what it is) is an ordinary question with no tool, answered briefly; showing, presenting, pitching or telling the story (and 'yes, show me' after Q offered) stays NAVIGATE Q_PITCH. Read by meaning in any language; schema unchanged.",
  effectiveFrom: "2026-10-21",
  template: TURN_READER_V56.template.replace(
    V53_Q_PITCH,
    `${V53_Q_PITCH}${V57_WHAT_IS_CAPITAL_Q}`,
  ),
};
