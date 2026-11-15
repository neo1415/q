import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV3,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V12 } from "./gateq-interviewer.v12.js";

/**
 * GATEQ_INTERVIEWER v13: money is money only as said (live
 * re-certification 64637e8c9, Dukaari Africa,
 * audits/2026-11-14-gateq-sustained-journey.md).
 *
 * In the eighth run "It buys about 18 months" was read as a raise of 18:
 * MONEY with no unit, because `unit` was asked only for a COUNT. v13 says
 * a span of time is never MONEY (it is a COUNT of months, runway when the
 * round buys it), and asks `unit` of every MONEY too: the currency as they
 * said it, or null. The platform keeps a MONEY value as money only when a
 * currency or money unit was said. v12 listed `cac` but still told the
 * reader "CAC is not on the list: null", so the CAC unknown carried no
 * metric; that sentence is replaced.
 *
 * Same variables and output schema as v12.
 */
const swaps: readonly (readonly [string, string])[] = [
  [
    "MONEY for an amount (decimal string, currency code or null when they named none);",
    'MONEY for an amount of money only (decimal string, currency code or null when they named none); a span of time is never MONEY: "it buys about 18 months" is COUNT 18 on raise.use_of_funds, quantity runway_months, unit "month";',
  ],
  [
    "null for prose or a metric not on the list (CAC is not on the list: null).",
    'null for prose or a metric not on the list. CAC is on the list: "we don\'t know our CAC yet" carries quantity cac.',
  ],
  [
    "null for anything that is not a COUNT.",
    'For MONEY, the currency as they said it ("$", "USD", "shillings"), or null when they named none: a number with no currency or money word is not money. null for anything else.',
  ],
];
let template = GATEQ_INTERVIEWER_V12.template;
for (const [from, to] of swaps) {
  if (!template.includes(from))
    throw new Error(`GATEQ_INTERVIEWER_V13: anchor moved: ${from}`);
  template = template.replace(from, to);
}

export const GATEQ_INTERVIEWER_V13: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV3
> = {
  ...GATEQ_INTERVIEWER_V12,
  version: 13,
  effectiveFrom: "2026-11-15",
  changeDescription:
    'Money is money only as said (live 64637e8c9: "It buys about 18 months" became a raise of USD 18): a span of time is a COUNT of months, runway when the round buys it; `unit` on MONEY is the currency said or null; CAC carries quantity cac.',
  template,
};
