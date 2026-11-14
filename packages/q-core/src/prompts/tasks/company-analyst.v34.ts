import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V34_SCHEMA_VERSION,
  CompanyAnalystV34ResultSchema,
  type CompanyAnalystV34Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V33 } from "./company-analyst.v33.js";

/**
 * COMPANY_ANALYST v34 -- decision 97 (2026-11-14): v33's template, word for
 * word, with output schema v34, which has no count ceiling on the evidence
 * lists (findings, missing evidence, contradictions, assumptions,
 * wouldChangeIf, company findings, coverage, material changes, profile
 * updates). v33's bounds let the gateway keep a list's first items and
 * lose the rest silently.
 */
export const COMPANY_ANALYST_V34: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV34Result
> = {
  ...COMPANY_ANALYST_V33,
  version: 34,
  status: "ACTIVE",
  changeDescription:
    "Decision 97 (14 Nov 2026): v33's template unchanged; output schema v34 removes the count ceilings on the evidence lists so nothing the analyst found beyond a bound is silently dropped. Product-rule bounds (clarifying questions, stated figures) stay.",
  effectiveFrom: "2026-11-14",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V34_SCHEMA_VERSION,
    schema: CompanyAnalystV34ResultSchema,
  },
};
