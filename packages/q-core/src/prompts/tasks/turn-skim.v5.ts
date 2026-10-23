import { TURN_SKIM_V4 } from "./turn-skim.v4.js";

/** No second classifier: the existing skim certifies only a complete list ask. */
export const V5_COMPOUND_FIT = `FIT and DISCOVER_COMPANIES apply only when the entire request is answered by the company list and its computed fit reasons. If they also request historical work, what Q learned, weaknesses, missing evidence or analysis beyond that list, return OTHER so the existing full reader preserves the whole question. "Which companies fit my mandate and what did Q learn about them?" and "Which companies fit my mandate and what are their weaknesses?" are OTHER. "Which companies fit my mandate and why?" remains FIT. Read the meaning in any words or language, not keywords.\n`;

export const TURN_SKIM_V5: typeof TURN_SKIM_V4 = {
  ...TURN_SKIM_V4,
  version: 5,
  status: "DEPRECATED",
  changeDescription:
    "The existing fast skim sends compound list-plus-analysis requests to the normal reader; pure list and ranking requests retain the fast lane.",
  effectiveFrom: "2026-10-13",
  template: TURN_SKIM_V4.template.replace(
    "confidence: HIGH only",
    `${V5_COMPOUND_FIT}\nconfidence: HIGH only`,
  ),
};
