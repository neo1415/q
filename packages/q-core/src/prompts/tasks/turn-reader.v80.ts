import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV76Variables,
  TurnReaderV79Result,
} from "../schemas/turn-reader.js";
import { V78_WHAT_WAS_ASKED } from "./turn-reader.v78.js";
import { TURN_READER_V79, V79_REFERENCE_NAMES } from "./turn-reader.v79.js";

/**
 * v80 (live Q-IQ 2026-11-06 on 61b7a85, AMB-136 #0). "What's Silo's
 * runway?" -- Silo Credit and Silo Health are both on the person's record
 * -- was answered as Silo Credit, and the code that asks "Silo Credit or
 * Silo Health?" never saw the name. v58's NAMED OTHER asks for the name
 * "spelled properly and in full" and null "when you cannot tell who": a
 * partial name that could be two companies was completed or left null.
 * v80 says such a name is namedOther exactly as they wrote it; code then
 * checks it against their own record and asks when two fit
 * (q-specialists name-candidates.ts). Nothing is decided by the reader.
 * v79 is kept whole; the line sits right after v79's rule, so the cached
 * prefix before it is unchanged. The output schema is v79's.
 */
export const V80_NAME_AS_SAID = `NAMED OTHER AS SAID: a company name they wrote in part, or that could be more than one company ("Silo", "the Ledger one"), is still namedOther, written exactly as they wrote it, kind COMPANY -- never completed into a fuller name you guess, and never null because you cannot tell which one; Capital Q checks it against their records and asks which one when two fit.
`;

if (
  TURN_READER_V79.template.split(`${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}`)
    .length !== 2
) {
  throw new Error(
    "TURN_READER v80 extends v79's REFERENCES BY NAME, which changed",
  );
}

export const TURN_READER_V80: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV79Result
> = {
  ...TURN_READER_V79,
  version: 80,
  status: "ACTIVE",
  changeDescription:
    "Live Q-IQ AMB-136 on 61b7a85: v79 plus NAMED OTHER AS SAID -- a partial or possibly-ambiguous company name they wrote ('Silo') is namedOther exactly as written, never completed or left null, so code can check it against their record and ask when two companies fit. Output schema unchanged.",
  effectiveFrom: "2026-11-06",
  template: TURN_READER_V79.template.replace(
    `${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}`,
    `${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}${V80_NAME_AS_SAID}`,
  ),
};
