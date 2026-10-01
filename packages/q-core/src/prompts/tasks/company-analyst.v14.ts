import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V14_SCHEMA_VERSION,
  CompanyAnalystV14ResultSchema,
  type CompanyAnalystV14Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V13 } from "./company-analyst.v13.js";

/**
 * COMPANY_ANALYST v14 -- PRESENCE (founder direction 2026-10-01): beside
 * the answer, an optional closed-set gesture per sentence for what Q's
 * particles form while it is said (a dollar sign for money, buildings for
 * companies, clapping when impressed). Chosen by the model, never by a
 * pattern over the words; clamped by code. The task text is v13's.
 */
export const COMPANY_ANALYST_V14: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV14Result
> = {
  ...COMPANY_ANALYST_V13,
  version: 14,
  status: "ACTIVE",
  changeDescription:
    "PRESENCE 2026-10-01: optional gestures beside the answer (sentence index + closed-set gesture) for Q's particles; v13 otherwise unchanged.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V14_SCHEMA_VERSION,
    schema: CompanyAnalystV14ResultSchema,
  },
  // The text is v13's: the field and its guidance travel in the output
  // schema (the task bundle is at its size budget).
  template: COMPANY_ANALYST_V13.template,
};
