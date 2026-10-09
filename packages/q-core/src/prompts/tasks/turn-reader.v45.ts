import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V45_SCHEMA_VERSION,
  TurnReaderV45ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV45Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V44 } from "./turn-reader.v44.js";

/**
 * TURN_READER v45 -- FIT QUESTIONS AND "STILL WAITING" (Zino, live
 * 2026-10-09 07:29-07:32 UTC, production 677c9f53).
 *
 * "Give me three good examples of companies I can invest in" was read as
 * ADVICE / REAL_WORLD_EXAMPLE and researched on the public web: 23-30 s,
 * while "top three" reached the computed fit in well under a second. Which
 * companies on Capital Q they could invest in is one question in any
 * words, so the reader names it (FIT, with the count it asks for) and code
 * answers it from the fit against their mandate. "Still waiting, can you
 * do it or not" after an unanswered ask is that ask again, not a new one.
 */
export const V44_REAL_WORLD_EXAMPLE =
  "- REAL_WORLD_EXAMPLE: they want a real, named example from the world — an actual investor, company, deal.";
export const V45_FIT = `- FIT: which companies on Capital Q they could invest in, or which fit them or their mandate best, in any words and with any number ("give me three good examples of companies I can invest in", "which ones could I actually invest in", "best companies for me"). Q answers it from the fit computed against their mandate, never from the public web. FIT over ADVICE and REAL_WORLD_EXAMPLE whenever the companies are ones for them to invest in. count: how many companies they asked for; null when they named no number, and for every other kind.
`;
export const V45_STILL_WAITING = `STILL WAITING: a turn that only presses on their own earlier ask that Q has not answered yet ("still waiting", "can you do it or not", "hello?", "well?") is that ask again: read it exactly as you would read that earlier ask (the same kind, question kind and count), with text the earlier ask's words. It is never a new question about Q.
`;

for (const anchor of [V44_REAL_WORLD_EXAMPLE, "HEARD AS:"]) {
  if (TURN_READER_V44.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v45 rewrites v44, which changed: ${anchor}`);
  }
}

export const TURN_READER_V45: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV45Result
> = {
  ...TURN_READER_V44,
  version: 45,
  status: "ACTIVE",
  changeDescription:
    "Zino live 2026-10-09: which companies they could invest in is the FIT question kind in any words, with its count, answered from the computed fit and never researched; a turn that only presses on an unanswered ask is read as that ask.",
  effectiveFrom: "2026-10-09",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V45_SCHEMA_VERSION,
    schema: TurnReaderV45ResultSchema,
  },
  template: TURN_READER_V44.template
    .replace(V44_REAL_WORLD_EXAMPLE, `${V45_FIT}${V44_REAL_WORLD_EXAMPLE}`)
    .replace("HEARD AS:", `${V45_STILL_WAITING}HEARD AS:`),
};
