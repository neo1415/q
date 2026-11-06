import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV76Variables,
  TurnReaderV79Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V80 } from "./turn-reader.v80.js";

/**
 * v81 (live Q-IQ run 2, 2026-11-06: FOLLOW_UPS 81.3% against the bare
 * model's 97.3%). "Same question for Tamarind Pay." after "What about the
 * monthly burn?" was answered with the FIRST question's figure (FUP-031,
 * 032, 036, 037, 038, 039, 042, 044, 045 #3), and "Roughly how much cash
 * does that runway imply?" with a year of burn (NUM-112 #4). v78 left
 * `parts` empty for every single ask, so the answer model had to rebuild
 * an elliptical ask from the whole conversation inside a long prompt, and
 * anchored on the first question asked.
 *
 * v81: a single ask that leans on earlier turns for what or whom it is
 * about is one part, made self-standing from RECENT TURNS -- the same
 * self-standing restatement v78 already asks for each part of a compound
 * ask. "Same question" is what they asked last. Read by meaning, never a
 * word list; code quotes it to the answer as data
 * (model-gateway askPartsNote). A single ask that already stands alone
 * still leaves parts empty. One sentence of v78's rule is replaced; the
 * output schema is v79's (parts already allows one entry).
 */
export const V81_SINGLE_ASK_FROM =
  "A single ask leaves parts empty (leave it out).";
export const V81_SINGLE_ASK = `A single ask that stands alone leaves parts empty (leave it out). A single ask that leans on earlier turns for what or whom it is about ("and its burn?", "what about the raise?", "same question for Silo Health", "how much cash does that runway imply?") is one part: ask is it made self-standing from RECENT TURNS ("What's Silo Health's customer count?"), the company or person it is about now and the thing they ask for now; "same question for X" asks X what they asked last, never their first question.`;

if (TURN_READER_V80.template.split(V81_SINGLE_ASK_FROM).length !== 2) {
  throw new Error(
    "TURN_READER v81 extends v78's single-ask sentence, which changed",
  );
}

export const TURN_READER_V81: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV79Result
> = {
  ...TURN_READER_V80,
  version: 81,
  status: "ACTIVE",
  changeDescription:
    "Live Q-IQ run 2 FOLLOW_UPS: a single ask that leans on earlier turns ('and its burn?', 'same question for X') is one part, made self-standing from RECENT TURNS; 'same question' is what they asked last. A self-standing single ask still leaves parts empty. Output schema unchanged (v79).",
  effectiveFrom: "2026-11-06",
  template: TURN_READER_V80.template.replace(
    V81_SINGLE_ASK_FROM,
    V81_SINGLE_ASK,
  ),
};
