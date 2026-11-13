import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV30Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V30 } from "./company-analyst.v30.js";

/**
 * COMPANY_ANALYST v31 -- a figure a founder states is proposed, never
 * implied recorded (A8, live 13 Nov 2026, founder.maji-loop: "Good news:
 * we hit $120k MRR in October." went into userStatements only; the model
 * never called propose_company_figure, no card was made, and Q answered
 * about "an approved company figure" as if the record were the point).
 * The userStatements line, the template's one rule about a fact they
 * state, now says that a figure their company reached is also prepared
 * with the figure tool when the run holds it, and stays unrecorded until
 * they approve (the ACTING rule already forbids saying it is done). The
 * tool's own description carries what it records; the template only
 * joins the two. Seven phrases are said more briefly to keep the 5%
 * headroom. Output schema v30 unchanged; every v30 rule stays.
 */
export const V31_CHANGES: ReadonlyArray<readonly [string, string]> = [
  [
    "userStatements: only a fact they state in THIS message about their own company, in their words; never a request, question or unclear words.",
    "userStatements: only a fact they state in THIS message about their own company, in their words; never a request, question or unclear words. A figure it reached: also call propose_company_figure if held; unrecorded until they approve.",
  ],
  // Said more briefly to keep the 5% headroom (prompts.test.ts); every
  // rule stays.
  [
    "do not choose between them, average them, or prefer the larger",
    "never choose, average or prefer the larger",
  ],
  [
    "Put that view in the recommendation field with its confidence and assumptions; leave it null only when",
    "Put that view in recommendation with its confidence and assumptions; null only when",
  ],
  [
    "Honour a preference, pronunciation or correction without being asked again;",
    "Honour a preference, pronunciation or correction unasked;",
  ],
  ["not repeated for every item.", "not for every item."],
  [
    "only when the facts, the conversation and every tool result",
    "only when the facts, conversation and every tool result",
  ],
  [
    "(scores exactly as the fit tools gave them)",
    "(scores exactly as the fit tools gave)",
  ],
  ["written as you would speak to them.", "written as you'd speak to them."],
];

for (const [from] of V31_CHANGES) {
  if (COMPANY_ANALYST_V30.template.split(from).length !== 2) {
    throw new Error(`COMPANY_ANALYST v31 extends v30, which changed: ${from}`);
  }
}

export const COMPANY_ANALYST_V31: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV30Result
> = {
  ...COMPANY_ANALYST_V30,
  version: 31,
  status: "ACTIVE",
  changeDescription:
    "A8 (13 Nov 2026): a figure their company reached that a founder states is also prepared with propose_company_figure when the run holds it, and stays unrecorded until they approve that card; seven phrases said more briefly for headroom. Output schema v30 unchanged; every v30 rule stays.",
  effectiveFrom: "2026-11-13",
  template: V31_CHANGES.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V30.template,
  ),
};
