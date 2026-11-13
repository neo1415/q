import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V30_SCHEMA_VERSION,
  CompanyAnalystV30ResultSchema,
  type CompanyAnalystV30Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { V26_ALLOWED_ROOT_KEYS } from "./company-analyst.v26.js";
import { COMPANY_ANALYST_V29 } from "./company-analyst.v29.js";

/**
 * COMPANY_ANALYST v30 -- Q's offers are durable and executable (C3,
 * acceptance 13 Nov 2026). A closing offer written only in prose ("Want
 * me to draft a follow-up to Savanna?") left nothing for a yes to bind
 * to. The answer now also returns the offer it made in `offer` (the
 * sentence, the one tool of this turn that does it, and what exactly it
 * would do); what the field means is in the output schema (OFFER_GUIDANCE),
 * so the template only names the key and says where an offer goes; six
 * sentences are said more briefly to keep the 5% headroom. Output schema
 * v30 (v26's plus `offer`). Every v29 rule stays.
 */
export const V30_ALLOWED_ROOT_KEYS = [
  ...V26_ALLOWED_ROOT_KEYS,
  "offer",
] as const;

export const V30_CHANGES: ReadonlyArray<readonly [string, string]> = [
  [V26_ALLOWED_ROOT_KEYS.join(", "), V30_ALLOWED_ROOT_KEYS.join(", ")],
  [
    "No followUps: next steps belong in answer;",
    "No followUps: next steps belong in answer (an offer also in offer);",
  ],
  // Said more briefly to keep the 5% headroom (prompts.test.ts); every
  // rule stays.
  [
    "What you happen to know about this company is not evidence about it,",
    "What you happen to know about this company is not evidence,",
  ],
  [
    "Thin evidence is not a reason to refuse to think: reason with what is known, state assumptions, and give a conditional view",
    "Thin evidence is no reason not to think: reason with what is known, state assumptions, give a conditional view",
  ],
  [
    "Use clarifyingQuestions for at most three questions that would change the answer.",
    "clarifyingQuestions: at most three questions that would change the answer.",
  ],
  [
    "(a timestamp changing is not a change)",
    "(a new timestamp is not a change)",
  ],
  [
    "STRENGTH only where a fact supports it, stated as what the evidence shows,",
    "STRENGTH only where a fact supports it, as what the evidence shows,",
  ],
  [
    "You talk with this person the way a sharp senior analyst talks",
    "You talk with this person as a sharp senior analyst talks",
  ],
];

for (const [from] of V30_CHANGES) {
  if (COMPANY_ANALYST_V29.template.split(from).length !== 2) {
    throw new Error(`COMPANY_ANALYST v30 extends v29, which changed: ${from}`);
  }
}

export const COMPANY_ANALYST_V30: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV30Result
> = {
  ...COMPANY_ANALYST_V29,
  version: 30,
  status: "ACTIVE",
  changeDescription:
    "C3 (13 Nov 2026): the offer an answer closes with is also returned as a record -- the sentence, the one tool of the turn that does it, and what exactly it would do -- so a yes binds to it; an offer no tool can carry out is removed. Output schema v30 adds `offer`. Every v29 rule stays.",
  effectiveFrom: "2026-11-13",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V30_SCHEMA_VERSION,
    schema: CompanyAnalystV30ResultSchema,
  },
  template: V30_CHANGES.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V29.template,
  ),
};
