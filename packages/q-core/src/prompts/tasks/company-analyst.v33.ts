import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V33_SCHEMA_VERSION,
  CompanyAnalystV33ResultSchema,
  type CompanyAnalystV33Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { V30_ALLOWED_ROOT_KEYS } from "./company-analyst.v30.js";
import { COMPANY_ANALYST_V32 } from "./company-analyst.v32.js";

/**
 * COMPANY_ANALYST v33 -- a figure they state is also returned as structure
 * (A8, live 14 Nov 2026, founder.maji-loop on 4d5ab3ac2: after an approved
 * "$120k MRR in October", "Actually October MRR was $110k." went down the
 * tool path with 125 tools, the model called none and put the figure only
 * in userStatements, where its key and month were refused and dropped; Q
 * said "I haven't saved that yet." with no card. Twice, on two builds:
 * prompt wording alone does not make the call reliable).
 *
 * Output schema v33 adds `statedFigures`: the metric (the figure action's
 * closed list), amount, currency as stated, period and their words. Capital
 * Q prepares the figure action's own approval card from it when the run did
 * not, through that action's authorize step and checks; the reading itself
 * is never written. The userStatements rule names the new key; five phrases
 * are said more briefly to keep the 5% headroom. Every v32 rule stays.
 */
export const V33_ALLOWED_ROOT_KEYS = [
  ...V30_ALLOWED_ROOT_KEYS,
  "statedFigures",
] as const;

export const V33_CHANGES: ReadonlyArray<readonly [string, string]> = [
  [V30_ALLOWED_ROOT_KEYS.join(", "), V33_ALLOWED_ROOT_KEYS.join(", ")],
  [
    "A figure it reached, or a correction: also call propose_company_figure if held;",
    "A figure it reached, or a correction: also statedFigures, and propose_company_figure if held;",
  ],
  // Said more briefly to keep the 5% headroom (prompts.test.ts); every
  // rule stays.
  [
    "one specific question, in your answer; else leave clarifyingQuestions empty.",
    "one specific question, in your answer; else clarifyingQuestions empty.",
  ],
  [
    "Explain what the evidence shows instead. Do not decide whether anyone should invest.",
    "Say what the evidence shows instead. Never decide whether anyone should invest.",
  ],
  [
    "Never quote internal text back: goals,",
    "Never quote internal text: goals,",
  ],
  [
    "the answer is a few spoken sentences, never a table of them.",
    "the answer is a few spoken sentences, never a table.",
  ],
  [
    "corrections, facts they stated, earlier conversations.",
    "corrections, facts stated, earlier conversations.",
  ],
];

for (const [from] of V33_CHANGES) {
  if (COMPANY_ANALYST_V32.template.split(from).length !== 2) {
    throw new Error(`COMPANY_ANALYST v33 extends v32, which changed: ${from}`);
  }
}

export const COMPANY_ANALYST_V33: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV33Result
> = {
  ...COMPANY_ANALYST_V32,
  version: 33,
  status: "ACTIVE",
  changeDescription:
    "A8 (14 Nov 2026): a figure a founder states about their own company, or a correction of one, is also returned in statedFigures (metric from the figure action's closed list, amount, currency as stated, period, their words), so Capital Q can prepare that action's approval card when the run did not. Output schema v33 adds `statedFigures`; every v32 rule stays.",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V33_SCHEMA_VERSION,
    schema: CompanyAnalystV33ResultSchema,
  },
  template: V33_CHANGES.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V32.template,
  ),
};
