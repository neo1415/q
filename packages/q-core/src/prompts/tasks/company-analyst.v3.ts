import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V3_SCHEMA_VERSION,
  CompanyAnalystV3ResultSchema,
  type CompanyAnalystV2Variables,
  type CompanyAnalystV3Result,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V2 } from "./company-analyst.v2.js";

/**
 * COMPANY_ANALYST v3 — v2's template, word for word, with one more field
 * in the structured result: `profileUpdates`, a change the person asked
 * for to their own company's declared profile (ADR 0011). The instruction
 * for it travels as a platform note when the conversation is about a
 * company, so the pinned template did not have to change; the output
 * schema did, and a schema is part of what a version pins.
 */
export const COMPANY_ANALYST_V3: PromptDefinition<
  CompanyAnalystV2Variables,
  CompanyAnalystV3Result
> = {
  ...COMPANY_ANALYST_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "ADR 0011: the structured result carries profileUpdates, a requested change to the person's own company profile, quoted from their words, for the Approval Engine to propose.",
  effectiveFrom: "2026-09-17",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V3_SCHEMA_VERSION,
    schema: CompanyAnalystV3ResultSchema,
  },
};
