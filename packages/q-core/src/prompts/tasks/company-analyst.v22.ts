import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V22_SCHEMA_VERSION,
  CompanyAnalystV22ResultSchema,
  type CompanyAnalystV22Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V21,
  V21_NO_DISCLAIMER_LINE,
} from "./company-analyst.v21.js";

/**
 * COMPANY_ANALYST v22 -- a visual, when one would show the answer better
 * (RECOVERY-2026-10, workstream E's request: maps, charts, tables and
 * timelines as standalone blocks beside Q). The model names only the kind;
 * Capital Q draws it from the run's own reads and draws nothing when no
 * read supports it. One line after v21's disclaimer rule; output schema
 * v22 adds the optional `visual`.
 */
export const V22_VISUAL_LINE =
  "- visual: MAP, TABLE, CHART or TIMELINE when clearer; drawn from Capital Q's reads.";

if (COMPANY_ANALYST_V21.template.split(V21_NO_DISCLAIMER_LINE).length !== 2) {
  throw new Error(
    "COMPANY_ANALYST v22 extends v21, which changed: disclaimer line",
  );
}

export const COMPANY_ANALYST_V22: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV22Result
> = {
  ...COMPANY_ANALYST_V21,
  version: 22,
  status: "ACTIVE",
  changeDescription:
    "RECOVERY-2026-10 (workstream E): the model may ask for a standalone visual (MAP, CHART, TABLE, TIMELINE); Capital Q draws it from the run's reads only. One line after v21's disclaimer rule; output schema v22 adds optional visual.",
  effectiveFrom: "2026-10-08",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V22_SCHEMA_VERSION,
    schema: CompanyAnalystV22ResultSchema,
  },
  template: COMPANY_ANALYST_V21.template.replace(
    V21_NO_DISCLAIMER_LINE,
    `${V21_NO_DISCLAIMER_LINE}\n${V22_VISUAL_LINE}`,
  ),
};
